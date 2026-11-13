package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync"
	"time"

	"github.com/nethstore/estudio/api/internal/store"
)

// Queue settings (SPEC 10).
const (
	JobTimeout    = 60 * time.Second
	PollInterval  = time.Second
	StuckAfter    = 3 * time.Minute
	StuckInterval = time.Minute
)

// RetryDelays are the waits before each retry of a transient failure. The
// first run plus len(RetryDelays) retries is the maximum number of attempts.
var RetryDelays = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute}

// Runner processes one photo.
type Runner interface {
	Process(ctx context.Context, photoID string) error
}

// Pool runs the workers.
type Pool struct {
	DB      *store.DB
	Runner  Runner
	Workers int
	Now     func() time.Time
	Log     *slog.Logger

	wake     chan struct{}
	stop     chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
	// jobCtx is the parent of every job context; cancelled only after the
	// graceful wait expires.
	jobCtx    context.Context
	jobCancel context.CancelFunc
}

// NewPool builds a pool.
func NewPool(db *store.DB, r Runner, workers int, log *slog.Logger) *Pool {
	ctx, cancel := context.WithCancel(context.Background())
	return &Pool{
		DB: db, Runner: r, Workers: workers, Now: time.Now, Log: log,
		wake: make(chan struct{}, workers), stop: make(chan struct{}),
		jobCtx: ctx, jobCancel: cancel,
	}
}

// Notify wakes idle workers (non-blocking).
func (p *Pool) Notify() {
	for range p.Workers {
		select {
		case p.wake <- struct{}{}:
		default:
			return
		}
	}
}

// Start recovers stuck jobs and launches the workers and the stuck-job loop.
func (p *Pool) Start() {
	p.requeueStuck()
	for i := range p.Workers {
		p.wg.Add(1)
		go p.worker(i)
	}
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		t := time.NewTicker(StuckInterval)
		defer t.Stop()
		for {
			select {
			case <-p.stop:
				return
			case <-t.C:
				p.requeueStuck()
			}
		}
	}()
}

// Shutdown stops fetching jobs and waits for running ones until ctx is done;
// then it cancels them and waits for the workers to return.
func (p *Pool) Shutdown(ctx context.Context) error {
	p.stopOnce.Do(func() { close(p.stop) })
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done:
		p.jobCancel()
		return nil
	case <-ctx.Done():
		p.jobCancel()
		<-done
		return ctx.Err()
	}
}

func (p *Pool) requeueStuck() {
	now := p.Now().UTC()
	n, err := p.DB.RequeueStuck(context.Background(), now.Add(-StuckAfter), now)
	if err != nil {
		p.Log.Error("requeue stuck jobs", "err", err)
		return
	}
	if n > 0 {
		p.Log.Warn("requeued stuck jobs", "count", n)
	}
}

func (p *Pool) worker(id int) {
	defer p.wg.Done()
	t := time.NewTicker(PollInterval)
	defer t.Stop()
	for {
		// Drain the queue before sleeping.
		for {
			select {
			case <-p.stop:
				return
			default:
			}
			if !p.RunOnce() {
				break
			}
		}
		select {
		case <-p.stop:
			return
		case <-p.wake:
		case <-t.C:
		}
	}
}

// RunOnce reserves and runs one job. It reports whether a job was found.
func (p *Pool) RunOnce() bool {
	now := p.Now().UTC()
	job, err := p.DB.ReserveJob(context.Background(), now)
	if errors.Is(err, store.ErrNotFound) {
		return false
	}
	if err != nil {
		p.Log.Error("reserve job", "err", err)
		return false
	}
	start := time.Now()
	err = p.run(job)
	log := p.Log.With("job_id", job.ID, "photo_id", job.PhotoID, "attempt", job.Attempts, "duration_ms", time.Since(start).Milliseconds())
	p.finish(job, err, log)
	return true
}

func (p *Pool) run(job store.Job) (err error) {
	ctx, cancel := context.WithTimeout(p.jobCtx, JobTimeout)
	defer cancel()
	defer func() {
		if r := recover(); r != nil {
			err = &StepError{Step: store.StepPrepare, Err: fmt.Errorf("panic: %v\n%s", r, debug.Stack())}
		}
	}()
	return p.Runner.Process(ctx, job.PhotoID)
}

func (p *Pool) finish(job store.Job, err error, log *slog.Logger) {
	ctx := context.Background()
	now := p.Now().UTC()
	if err == nil {
		if e := p.DB.CompleteJob(ctx, job.ID); e != nil {
			log.Error("complete job", "err", e)
		}
		log.Info("job done")
		return
	}

	var perm *PermanentError
	if errors.As(err, &perm) {
		log.Warn("job failed permanently", "step", perm.Step, "code", perm.Code, "err", err)
		p.failPhoto(ctx, job, perm.Step, perm.Code, err.Error(), log)
		return
	}

	step := store.StepPrepare
	var se *StepError
	if errors.As(err, &se) {
		step = se.Step
	}
	retry := job.Attempts - 1
	if retry < len(RetryDelays) {
		runAfter := now.Add(RetryDelays[retry])
		log.Warn("job failed, will retry", "step", step, "retry_in_s", int(RetryDelays[retry].Seconds()), "err", err)
		if e := p.DB.RescheduleJob(ctx, job.ID, runAfter, err.Error()); e != nil {
			log.Error("reschedule job", "err", e)
		}
		return
	}
	log.Error("job failed after retries", "step", step, "err", err)
	p.failPhoto(ctx, job, step, "processing_failed", err.Error(), log)
}

func (p *Pool) failPhoto(ctx context.Context, job store.Job, step, code, msg string, log *slog.Logger) {
	if e := p.DB.FailJob(ctx, job.ID, msg); e != nil {
		log.Error("fail job", "err", e)
	}
	if e := p.DB.SetPhotoFailed(ctx, job.PhotoID, step, code, p.Now().UTC()); e != nil {
		log.Error("fail photo", "err", e)
	}
}
