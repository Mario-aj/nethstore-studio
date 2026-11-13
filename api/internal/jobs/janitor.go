package jobs

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/store"
)

// Janitor applies retention and cleans expired rows (SPEC 10).
type Janitor struct {
	DB              *store.DB
	Storage         batches.Storage
	OriginalsMaxAge time.Duration
	BatchesMaxAge   time.Duration
	Now             func() time.Time
	Log             *slog.Logger
}

// Janitor timings.
const (
	AwaitingUploadLimit = 24 * time.Hour
	LoginAttemptsMaxAge = 7 * 24 * time.Hour
)

// Janitor schedule (variables so tests can shorten them).
var (
	JanitorInterval = 24 * time.Hour
	JanitorFirstRun = time.Minute
)

// Report summarizes one run.
type Report struct {
	ExpiredUploads  int64
	PurgedOriginals int
	DeletedBatches  int
	DeletedSessions int64
	DeletedAttempts int64
}

// RunOnce performs every cleanup step; it keeps going after a failure and
// returns the joined errors.
func (j *Janitor) RunOnce(ctx context.Context) (Report, error) {
	now := j.Now().UTC()
	var r Report
	var errs []error

	n, err := j.DB.ExpireAwaitingUploads(ctx, now.Add(-AwaitingUploadLimit), now)
	r.ExpiredUploads = n
	errs = append(errs, err)

	ids, err := j.DB.BatchesToPurgeOriginals(ctx, now.Add(-j.OriginalsMaxAge))
	errs = append(errs, err)
	for _, id := range ids {
		if err := j.purgeOriginals(ctx, id, now); err != nil {
			errs = append(errs, err)
			continue
		}
		r.PurgedOriginals++
	}

	ids, err = j.DB.BatchesOlderThan(ctx, now.Add(-j.BatchesMaxAge))
	errs = append(errs, err)
	for _, id := range ids {
		if err := batches.DeleteObjects(ctx, j.Storage, id); err != nil {
			errs = append(errs, err)
			continue
		}
		if err := j.DB.DeleteBatch(ctx, id); err != nil && !errors.Is(err, store.ErrNotFound) {
			errs = append(errs, err)
			continue
		}
		r.DeletedBatches++
	}

	r.DeletedSessions, err = j.DB.DeleteExpiredSessions(ctx, now)
	errs = append(errs, err)
	r.DeletedAttempts, err = j.DB.DeleteLoginAttemptsBefore(ctx, now.Add(-LoginAttemptsMaxAge))
	errs = append(errs, err)
	return r, errors.Join(errs...)
}

func (j *Janitor) purgeOriginals(ctx context.Context, batchID string, now time.Time) error {
	for _, prefix := range []string{"originals/", "thumbs/"} {
		if err := j.Storage.DeletePrefix(ctx, prefix+batchID+"/"); err != nil {
			return err
		}
	}
	return j.DB.MarkOriginalsPurged(ctx, batchID, now)
}

// Run executes RunOnce shortly after start and then daily, until ctx ends.
func (j *Janitor) Run(ctx context.Context) {
	t := time.NewTimer(JanitorFirstRun)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r, err := j.RunOnce(ctx)
			log := j.Log.With("expired_uploads", r.ExpiredUploads, "purged_originals", r.PurgedOriginals,
				"deleted_batches", r.DeletedBatches, "deleted_sessions", r.DeletedSessions, "deleted_attempts", r.DeletedAttempts)
			if err != nil {
				log.Error("janitor run finished with errors", "err", err)
			} else {
				log.Info("janitor run finished")
			}
			t.Reset(JanitorInterval)
		}
	}
}
