package jobs

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/stamp"
	"github.com/nethstore/estudio/api/internal/store"
	"github.com/nethstore/estudio/api/internal/testutil"
)

type env struct {
	db    *store.DB
	st    *testutil.MemStorage
	clock *testutil.Clock
	bs    *batches.Service
	proc  *Processor
	logs  *bytes.Buffer
}

func newEnv(t *testing.T) *env {
	e := &env{db: testutil.DB(t), st: testutil.NewMemStorage(), clock: testutil.NewClock(), logs: &bytes.Buffer{}}
	e.bs = &batches.Service{DB: e.db, Storage: e.st, Now: e.clock.Now, MaxPhotos: 50, MinBytes: 1024, MaxBytes: 15 << 20}
	e.proc = &Processor{DB: e.db, Storage: e.st, MaxBytes: 15 << 20, Layout: stamp.DefaultLayout(), Now: e.clock.Now, Log: testutil.Logger(e.logs)}
	return e
}

// uploaded creates a batch of n photos and uploads data for each.
func (e *env) uploaded(t *testing.T, n int, data func(i int) []byte) batches.Created {
	t.Helper()
	ctx := context.Background()
	out, err := e.bs.Create(ctx, batches.CreateInput{PriceKz: 10000, Sizes: []string{"M", "L"}, Description: "Veste", PhotoCount: n})
	if err != nil {
		t.Fatal(err)
	}
	for i, p := range out.Photos {
		e.st.Put(batches.OriginalKey(out.ID, p.ID), data(i))
		if err := e.bs.ConfirmUpload(ctx, p.ID); err != nil {
			t.Fatal(err)
		}
	}
	return out
}

func (e *env) pool(r Runner) *Pool {
	p := NewPool(e.db, r, 2, testutil.Logger(e.logs))
	p.Now = e.clock.Now
	return p
}

func TestProcessStampsAndThumbs(t *testing.T) {
	e := newEnv(t)
	jpg := testutil.JPEG(t, 1800, 2400, color.NRGBA{R: 230, G: 225, B: 215, A: 255})
	out := e.uploaded(t, 1, func(int) []byte { return jpg })
	pool := e.pool(e.proc)
	if !pool.RunOnce() {
		t.Fatal("no job")
	}
	if pool.RunOnce() {
		t.Fatal("job ran twice")
	}
	id := out.Photos[0].ID
	ph, _ := e.db.GetPhoto(context.Background(), id)
	if ph.Status != store.StatusStamped || *ph.Width != 1200 || *ph.Height != 1600 {
		t.Fatalf("photo %+v", ph)
	}
	final, _, err := image.Decode(bytes.NewReader(e.st.Bytes(batches.StampedKey(out.ID, id))))
	if err != nil || final.Bounds().Dx() != 1200 {
		t.Fatalf("stamped image: %v", err)
	}
	thumb, _, err := image.DecodeConfig(bytes.NewReader(e.st.Bytes(batches.ThumbKey(out.ID, id))))
	if err != nil || thumb.Height != 480 {
		t.Fatalf("thumb %+v %v", thumb, err)
	}
	// Text pixels near the top-left corner are dark on a light photo.
	r, g, b, _ := darkest(final, image.Rect(36, 112, 400, 260))
	if r > 80 || g > 80 || b > 80 {
		t.Fatalf("no dark stamp text found (%d,%d,%d)", r, g, b)
	}
	// Idempotent: processing again (e.g. after a crash) overwrites cleanly.
	if err := e.db.SetPhotoFailed(context.Background(), id, "stamp", "processing_failed", e.clock.Now()); err != nil {
		t.Fatal(err)
	}
	if err := e.bs.Retry(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if !pool.RunOnce() {
		t.Fatal("retry job missing")
	}
	if ph, _ := e.db.GetPhoto(context.Background(), id); ph.Status != store.StatusStamped {
		t.Fatalf("after retry %s", ph.Status)
	}
}

func darkest(img image.Image, r image.Rectangle) (uint8, uint8, uint8, uint8) {
	best := color.NRGBA{255, 255, 255, 255}
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			if int(c.R)+int(c.G)+int(c.B) < int(best.R)+int(best.G)+int(best.B) {
				best = c
			}
		}
	}
	return best.R, best.G, best.B, best.A
}

// SPEC 12.8 item 11 through the pipeline: permanent, no retry.
func TestInvalidImageFailsPermanently(t *testing.T) {
	e := newEnv(t)
	out := e.uploaded(t, 1, func(int) []byte { return bytes.Repeat([]byte("texto, não JPEG "), 100) })
	pool := e.pool(e.proc)
	pool.RunOnce()
	ph, _ := e.db.GetPhoto(context.Background(), out.Photos[0].ID)
	if ph.Status != store.StatusFailed || *ph.FailedStep != "prepare" || *ph.ErrorCode != "invalid_image" {
		t.Fatalf("photo %+v", ph)
	}
	e.clock.Advance(time.Hour)
	if pool.RunOnce() {
		t.Fatal("permanent failure was retried")
	}
}

func TestTransientFailureRetriesWithBackoff(t *testing.T) {
	e := newEnv(t)
	jpg := testutil.JPEG(t, 400, 600, color.NRGBA{R: 30, G: 30, B: 30, A: 255})
	out := e.uploaded(t, 1, func(int) []byte { return jpg })
	e.st.FailRead = 2
	pool := e.pool(e.proc)
	id := out.Photos[0].ID

	pool.RunOnce() // attempt 1 fails
	if pool.RunOnce() {
		t.Fatal("retried before 5 s")
	}
	e.clock.Advance(5 * time.Second)
	pool.RunOnce() // attempt 2 fails
	e.clock.Advance(29 * time.Second)
	if pool.RunOnce() {
		t.Fatal("retried before 30 s")
	}
	e.clock.Advance(time.Second)
	pool.RunOnce() // attempt 3 succeeds
	if ph, _ := e.db.GetPhoto(context.Background(), id); ph.Status != store.StatusStamped {
		t.Fatalf("status %s", ph.Status)
	}
}

func TestTransientFailureGivesUp(t *testing.T) {
	e := newEnv(t)
	jpg := testutil.JPEG(t, 400, 600, color.NRGBA{R: 30, A: 255})
	out := e.uploaded(t, 1, func(int) []byte { return jpg })
	e.st.FailPut = 100
	pool := e.pool(e.proc)
	for range 10 {
		pool.RunOnce()
		e.clock.Advance(3 * time.Minute)
	}
	ph, _ := e.db.GetPhoto(context.Background(), out.Photos[0].ID)
	if ph.Status != store.StatusFailed || *ph.FailedStep != "prepare" || *ph.ErrorCode != "processing_failed" {
		t.Fatalf("photo %+v", ph)
	}
}

func TestStampStepFailureIsReported(t *testing.T) {
	e := newEnv(t)
	jpg := testutil.JPEG(t, 400, 600, color.NRGBA{R: 30, A: 255})
	out := e.uploaded(t, 1, func(int) []byte { return jpg })
	pool := e.pool(e.proc)
	// The thumbnail write succeeds, the stamped write keeps failing.
	e.st.FailPut = 0
	failAfter := &failingAfter{MemStorage: e.st, okPuts: 1}
	e.proc.Storage = failAfter
	for range 10 {
		pool.RunOnce()
		e.clock.Advance(3 * time.Minute)
		failAfter.okPuts = 1
	}
	ph, _ := e.db.GetPhoto(context.Background(), out.Photos[0].ID)
	if ph.Status != store.StatusFailed || *ph.FailedStep != "stamp" {
		t.Fatalf("photo %+v", ph)
	}
}

type failingAfter struct {
	*testutil.MemStorage
	okPuts int
}

func (f *failingAfter) PutJPEG(ctx context.Context, key string, data []byte) error {
	if f.okPuts > 0 {
		f.okPuts--
		return f.MemStorage.PutJPEG(ctx, key, data)
	}
	return testutil.ErrTransient
}

type panicRunner struct{}

func (panicRunner) Process(context.Context, string) error { panic("boom") }

func TestPanicIsRecovered(t *testing.T) {
	e := newEnv(t)
	e.uploaded(t, 1, func(int) []byte { return bytes.Repeat([]byte("x"), 2048) })
	pool := e.pool(panicRunner{})
	pool.RunOnce()
	if !bytes.Contains(e.logs.Bytes(), []byte("panic: boom")) {
		t.Fatal("panic not logged")
	}
	e.clock.Advance(5 * time.Second)
	if !pool.RunOnce() {
		t.Fatal("panicked job not rescheduled")
	}
}

func TestStuckJobsAreRequeued(t *testing.T) {
	e := newEnv(t)
	e.uploaded(t, 1, func(int) []byte { return bytes.Repeat([]byte("x"), 2048) })
	ctx := context.Background()
	job, err := e.db.ReserveJob(ctx, e.clock.Now())
	if err != nil {
		t.Fatal(err)
	}
	e.clock.Advance(2 * time.Minute)
	pool := e.pool(e.proc)
	pool.requeueStuck()
	if st, _, _ := e.db.JobByID(ctx, job.ID); st != store.JobRunning {
		t.Fatalf("requeued too early: %s", st)
	}
	e.clock.Advance(2 * time.Minute)
	pool.requeueStuck()
	if st, _, _ := e.db.JobByID(ctx, job.ID); st != store.JobQueued {
		t.Fatalf("not requeued: %s", st)
	}
}

type slowRunner struct {
	started chan struct{}
	done    atomic.Bool
}

func (s *slowRunner) Process(ctx context.Context, _ string) error {
	close(s.started)
	select {
	case <-time.After(200 * time.Millisecond):
		s.done.Store(true)
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestGracefulShutdownWaitsForRunningJobs(t *testing.T) {
	e := newEnv(t)
	e.uploaded(t, 1, func(int) []byte { return bytes.Repeat([]byte("x"), 2048) })
	r := &slowRunner{started: make(chan struct{})}
	pool := NewPool(e.db, r, 1, testutil.Logger(nil))
	pool.Start()
	pool.Notify()
	<-r.started
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if !r.done.Load() {
		t.Fatal("shutdown did not wait for the running job")
	}
}

func TestShutdownTimeoutCancelsJobs(t *testing.T) {
	e := newEnv(t)
	e.uploaded(t, 1, func(int) []byte { return bytes.Repeat([]byte("x"), 2048) })
	r := &slowRunner{started: make(chan struct{})}
	pool := NewPool(e.db, r, 1, testutil.Logger(nil))
	pool.Start()
	pool.Notify()
	<-r.started
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := pool.Shutdown(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v", err)
	}
}

func TestFiftyPhotosBatch(t *testing.T) {
	e := newEnv(t)
	out := e.uploaded(t, 50, func(i int) []byte {
		c := color.NRGBA{R: uint8(i * 5), G: uint8(255 - i*5), B: 120, A: 255}
		if i%2 == 0 {
			return testutil.JPEG(t, 300, 400, c)
		}
		return testutil.JPEG(t, 400, 300, c)
	})
	pool := e.pool(e.proc)
	for pool.RunOnce() {
	}
	d, err := e.bs.Get(context.Background(), out.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !d.Finished || d.FailedCount != 0 || d.Steps.Ready.State != "completed" || *d.Steps.Stamp.Done != 50 {
		t.Fatalf("batch %+v", d.Steps)
	}
}

func TestJanitor(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	jpg := testutil.JPEG(t, 400, 600, color.NRGBA{R: 200, A: 255})
	old := e.uploaded(t, 1, func(int) []byte { return jpg })
	e.pool(e.proc).RunOnce()
	waiting, _ := e.bs.Create(ctx, batches.CreateInput{PriceKz: 5, Sizes: []string{"S"}, PhotoCount: 1})
	res, _ := authLogin(e)
	_ = res

	j := &Janitor{DB: e.db, Storage: e.st, OriginalsMaxAge: 30 * 24 * time.Hour, BatchesMaxAge: 90 * 24 * time.Hour, Now: e.clock.Now, Log: testutil.Logger(nil)}

	e.clock.Advance(25 * time.Hour)
	r, err := j.RunOnce(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if r.ExpiredUploads != 1 {
		t.Fatalf("report %+v", r)
	}
	if ph, _ := e.db.GetPhoto(ctx, waiting.Photos[0].ID); ph.Status != "failed" || *ph.ErrorCode != "upload_expired" {
		t.Fatalf("waiting photo %+v", ph)
	}

	e.clock.Advance(30 * 24 * time.Hour)
	if r, err = j.RunOnce(ctx); err != nil || r.PurgedOriginals != 2 || r.DeletedSessions != 1 || r.DeletedAttempts != 1 {
		t.Fatalf("report %+v %v", r, err)
	}
	if len(e.st.Keys("originals/")) != 0 || len(e.st.Keys("thumbs/")) != 0 || len(e.st.Keys("stamped/")) != 1 {
		t.Fatalf("objects %v", e.st.Keys(""))
	}
	if r, _ = j.RunOnce(ctx); r.PurgedOriginals != 0 {
		t.Fatal("purged twice")
	}

	e.clock.Advance(61 * 24 * time.Hour)
	if r, err = j.RunOnce(ctx); err != nil || r.DeletedBatches != 2 {
		t.Fatalf("report %+v %v", r, err)
	}
	if len(e.st.Keys("")) != 0 {
		t.Fatalf("objects left %v", e.st.Keys(""))
	}
	if _, err := e.db.GetBatch(ctx, old.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("old batch kept")
	}
}

// authLogin inserts one session (expires in 30 days) and one login attempt.
func authLogin(e *env) (struct{}, error) {
	ctx := context.Background()
	now := e.clock.Now()
	_ = e.db.CreateSession(ctx, store.Session{TokenHash: []byte("h"), CreatedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour), LastSeenAt: now})
	return struct{}{}, e.db.RecordLoginAttempt(ctx, "1.2.3.4", now, false)
}

func TestProcessorSkipsAndMissingOriginal(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	// Unknown photo: nothing to do.
	if err := e.proc.Process(ctx, "01933f6e-0000-7000-8000-000000000000"); err != nil {
		t.Fatal(err)
	}
	jpg := testutil.JPEG(t, 400, 600, color.NRGBA{R: 200, A: 255})
	out := e.uploaded(t, 2, func(int) []byte { return jpg })
	// Already stamped photos are skipped.
	id := out.Photos[0].ID
	_ = e.db.SetPhotoStamped(ctx, id, "k", e.clock.Now())
	if err := e.proc.Process(ctx, id); err != nil {
		t.Fatal(err)
	}
	// Original removed after confirmation: permanent failure.
	id2 := out.Photos[1].ID
	_ = e.st.DeletePrefix(ctx, "originals/")
	var perm *PermanentError
	if err := e.proc.Process(ctx, id2); !errors.As(err, &perm) || perm.Code != "processing_failed" || perm.Error() == "" || perm.Unwrap() == nil {
		t.Fatalf("err = %v", err)
	}
	se := &StepError{Step: "prepare", Err: testutil.ErrTransient}
	if se.Error() == "" || !errors.Is(se, testutil.ErrTransient) {
		t.Fatal("step error")
	}
}

func TestPoolProcessesAfterNotify(t *testing.T) {
	e := newEnv(t)
	jpg := testutil.JPEG(t, 300, 400, color.NRGBA{R: 200, A: 255})
	out := e.uploaded(t, 3, func(int) []byte { return jpg })
	pool := NewPool(e.db, e.proc, 2, testutil.Logger(nil))
	pool.Start()
	defer func() { _ = pool.Shutdown(context.Background()) }()
	pool.Notify()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		d, _ := e.bs.Get(context.Background(), out.ID)
		if d.Finished {
			if d.FailedCount != 0 {
				t.Fatalf("failed %d", d.FailedCount)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("batch not processed by the running pool")
}

func TestJanitorRunLoop(t *testing.T) {
	e := newEnv(t)
	logs := &bytes.Buffer{}
	oldFirst, oldInterval := JanitorFirstRun, JanitorInterval
	JanitorFirstRun, JanitorInterval = 5*time.Millisecond, time.Hour
	defer func() { JanitorFirstRun, JanitorInterval = oldFirst, oldInterval }()
	j := &Janitor{DB: e.db, Storage: e.st, OriginalsMaxAge: time.Hour, BatchesMaxAge: time.Hour, Now: e.clock.Now, Log: testutil.Logger(logs)}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { j.Run(ctx); close(done) }()
	time.Sleep(200 * time.Millisecond)
	cancel()
	<-done
	if !bytes.Contains(logs.Bytes(), []byte("janitor run finished")) {
		t.Fatalf("janitor did not run: %s", logs.String())
	}
}
