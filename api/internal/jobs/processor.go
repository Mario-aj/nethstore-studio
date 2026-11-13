// Package jobs runs the processing queue (SQLite table), its workers and the
// daily janitor.
package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/imaging"
	"github.com/nethstore/estudio/api/internal/stamp"
	"github.com/nethstore/estudio/api/internal/storage"
	"github.com/nethstore/estudio/api/internal/store"
)

// ObjectStore is what processing needs from storage.
type ObjectStore interface {
	ReadAll(ctx context.Context, key string, limit int64) ([]byte, error)
	PutJPEG(ctx context.Context, key string, data []byte) error
}

// PermanentError must not be retried.
type PermanentError struct {
	Step string
	Code string
	Err  error
}

func (e *PermanentError) Error() string { return fmt.Sprintf("%s/%s: %v", e.Step, e.Code, e.Err) }
func (e *PermanentError) Unwrap() error { return e.Err }

// StepError wraps a transient error with the step it happened in.
type StepError struct {
	Step string
	Err  error
}

func (e *StepError) Error() string { return e.Step + ": " + e.Err.Error() }
func (e *StepError) Unwrap() error { return e.Err }

// Processor runs the prepare and stamp steps of one photo.
type Processor struct {
	DB       *store.DB
	Storage  ObjectStore
	MaxBytes int64
	Layout   stamp.Layout
	Now      func() time.Time
	Log      *slog.Logger
}

// Process is idempotent: keys are deterministic and writes overwrite.
func (p *Processor) Process(ctx context.Context, photoID string) error {
	ph, err := p.DB.GetPhoto(ctx, photoID)
	if errors.Is(err, store.ErrNotFound) {
		return nil // batch deleted meanwhile
	}
	if err != nil {
		return &StepError{store.StepPrepare, err}
	}
	if ph.Status != store.StatusUploaded && ph.Status != store.StatusPrepared {
		return nil
	}
	b, err := p.DB.GetBatch(ctx, ph.BatchID)
	if errors.Is(err, store.ErrNotFound) {
		return nil
	}
	if err != nil {
		return &StepError{store.StepPrepare, err}
	}

	// prepare
	data, err := p.Storage.ReadAll(ctx, ph.OriginalKey, p.MaxBytes)
	if errors.Is(err, storage.ErrNotFound) {
		return &PermanentError{store.StepPrepare, "processing_failed", err}
	}
	if err != nil {
		return &StepError{store.StepPrepare, err}
	}
	img, err := imaging.Normalize(data)
	if err != nil {
		// Every decode failure is a property of the file: retrying cannot help.
		return &PermanentError{store.StepPrepare, "invalid_image", err}
	}
	thumb, err := imaging.Thumbnail(img)
	if err != nil {
		return &PermanentError{store.StepPrepare, "processing_failed", err}
	}
	thumbKey := batches.ThumbKey(b.ID, ph.ID)
	if err := p.Storage.PutJPEG(ctx, thumbKey, thumb); err != nil {
		return &StepError{store.StepPrepare, err}
	}
	bounds := img.Bounds()
	if err := p.DB.SetPhotoPrepared(ctx, ph.ID, thumbKey, bounds.Dx(), bounds.Dy(), p.Now().UTC()); err != nil {
		return &StepError{store.StepPrepare, err}
	}

	// stamp
	if _, err := stamp.Draw(img, b.StampLine1, b.StampLine2, p.Layout); err != nil {
		return &PermanentError{store.StepStamp, "processing_failed", err}
	}
	final, err := imaging.JPEGBytes(img, imaging.FinalQuality)
	if err != nil {
		return &PermanentError{store.StepStamp, "processing_failed", err}
	}
	stampedKey := batches.StampedKey(b.ID, ph.ID)
	if err := p.Storage.PutJPEG(ctx, stampedKey, final); err != nil {
		return &StepError{store.StepStamp, err}
	}
	// The thumbnail shown in the app is the stamped one (docs/DECISOES.md).
	if thumb, err := imaging.Thumbnail(img); err == nil {
		if err := p.Storage.PutJPEG(ctx, thumbKey, thumb); err != nil {
			return &StepError{store.StepStamp, err}
		}
	}
	if err := p.DB.SetPhotoStamped(ctx, ph.ID, stampedKey, p.Now().UTC()); err != nil {
		return &StepError{store.StepStamp, err}
	}
	return nil
}
