package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Photo statuses.
const (
	StatusAwaitingUpload = "awaiting_upload"
	StatusUploaded       = "uploaded"
	StatusPrepared       = "prepared"
	StatusStamped        = "stamped"
	StatusFailed         = "failed"
)

// Pipeline steps where a photo can fail.
const (
	StepUpload  = "upload"
	StepPrepare = "prepare"
	StepStamp   = "stamp"
)

// Errors returned by batch and photo writes.
var (
	ErrTooManyOpenBatches = errors.New("too many open batches")
	ErrInvalidState       = errors.New("invalid state")
)

// Batch is a row of the batches table.
type Batch struct {
	ID                string
	Seq               int64
	PriceKz           int64
	Sizes             []string
	Description       *string
	StampLine1        string
	StampLine2        string
	PhotoCount        int
	CreatedAt         time.Time
	OriginalsPurgedAt *time.Time
}

// Photo is a row of the photos table.
type Photo struct {
	ID          string
	BatchID     string
	Position    int
	Status      string
	FailedStep  *string
	ErrorCode   *string
	OriginalKey string
	ThumbKey    *string
	StampedKey  *string
	Bytes       *int64
	Width       *int64
	Height      *int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// BatchSummary is a batch with aggregated photo counts.
type BatchSummary struct {
	Batch
	StampedCount int
	FailedCount  int
	InFlight     int
}

const batchCols = `id, seq, price_kz, sizes, description, stamp_line1, stamp_line2, photo_count, created_at, originals_purged_at`

func scanBatch(sc interface{ Scan(...any) error }) (Batch, error) {
	var b Batch
	var sizes, created string
	var desc, purged sql.NullString
	if err := sc.Scan(&b.ID, &b.Seq, &b.PriceKz, &sizes, &desc, &b.StampLine1, &b.StampLine2, &b.PhotoCount, &created, &purged); err != nil {
		return b, err
	}
	if err := json.Unmarshal([]byte(sizes), &b.Sizes); err != nil {
		return b, err
	}
	if desc.Valid {
		b.Description = &desc.String
	}
	var err error
	if b.CreatedAt, err = ParseTime(created); err != nil {
		return b, err
	}
	if purged.Valid {
		t, err := ParseTime(purged.String)
		if err != nil {
			return b, err
		}
		b.OriginalsPurgedAt = &t
	}
	return b, nil
}

const photoCols = `id, batch_id, position, status, failed_step, error_code, original_key, thumb_key, stamped_key, bytes, width, height, created_at, updated_at`

func scanPhoto(sc interface{ Scan(...any) error }) (Photo, error) {
	var p Photo
	var failedStep, errorCode, thumb, stamped sql.NullString
	var bytes, width, height sql.NullInt64
	var created, updated string
	if err := sc.Scan(&p.ID, &p.BatchID, &p.Position, &p.Status, &failedStep, &errorCode, &p.OriginalKey, &thumb, &stamped, &bytes, &width, &height, &created, &updated); err != nil {
		return p, err
	}
	p.FailedStep = nullStr(failedStep)
	p.ErrorCode = nullStr(errorCode)
	p.ThumbKey = nullStr(thumb)
	p.StampedKey = nullStr(stamped)
	p.Bytes = nullInt(bytes)
	p.Width = nullInt(width)
	p.Height = nullInt(height)
	var err error
	if p.CreatedAt, err = ParseTime(created); err != nil {
		return p, err
	}
	if p.UpdatedAt, err = ParseTime(updated); err != nil {
		return p, err
	}
	return p, nil
}

func nullStr(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	v := s.String
	return &v
}

func nullInt(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

// CreateBatch inserts a batch and its photos. It assigns Seq and refuses when
// maxOpen batches already have photos awaiting upload.
func (d *DB) CreateBatch(ctx context.Context, b *Batch, photos []Photo, maxOpen int) error {
	sizes, err := json.Marshal(b.Sizes)
	if err != nil {
		return err
	}
	tx, err := d.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var open int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(DISTINCT batch_id) FROM photos WHERE status = ?`, StatusAwaitingUpload).Scan(&open); err != nil {
		return err
	}
	if open >= maxOpen {
		return ErrTooManyOpenBatches
	}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq), 0) + 1 FROM batches`).Scan(&b.Seq); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batches (id, seq, price_kz, sizes, description, stamp_line1, stamp_line2, photo_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.ID, b.Seq, b.PriceKz, string(sizes), b.Description, b.StampLine1, b.StampLine2, b.PhotoCount, FormatTime(b.CreatedAt)); err != nil {
		return err
	}
	for _, p := range photos {
		if _, err := tx.ExecContext(ctx, `INSERT INTO photos (id, batch_id, position, status, original_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			p.ID, b.ID, p.Position, StatusAwaitingUpload, p.OriginalKey, FormatTime(p.CreatedAt), FormatTime(p.CreatedAt)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetBatch loads one batch.
func (d *DB) GetBatch(ctx context.Context, id string) (Batch, error) {
	b, err := scanBatch(d.R.QueryRowContext(ctx, `SELECT `+batchCols+` FROM batches WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

// PhotosByBatch returns the batch photos ordered by position.
func (d *DB) PhotosByBatch(ctx context.Context, batchID string) ([]Photo, error) {
	rows, err := d.R.QueryContext(ctx, `SELECT `+photoCols+` FROM photos WHERE batch_id = ? ORDER BY position`, batchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Photo
	for rows.Next() {
		p, err := scanPhoto(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetPhoto loads one photo.
func (d *DB) GetPhoto(ctx context.Context, id string) (Photo, error) {
	p, err := scanPhoto(d.R.QueryRowContext(ctx, `SELECT `+photoCols+` FROM photos WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// ListBatches returns the most recent batches with counts.
func (d *DB) ListBatches(ctx context.Context, limit int) ([]BatchSummary, error) {
	rows, err := d.R.QueryContext(ctx, `SELECT b.id, b.seq, b.price_kz, b.sizes, b.description, b.stamp_line1, b.stamp_line2, b.photo_count, b.created_at, b.originals_purged_at,
		COALESCE(SUM(CASE WHEN p.status = 'stamped' THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN p.status IN ('awaiting_upload', 'uploaded', 'prepared') THEN 1 ELSE 0 END), 0)
		FROM batches b LEFT JOIN photos p ON p.batch_id = b.id
		GROUP BY b.id ORDER BY b.seq DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []BatchSummary
	for rows.Next() {
		var s BatchSummary
		var sizes, created string
		var desc, purged sql.NullString
		if err := rows.Scan(&s.ID, &s.Seq, &s.PriceKz, &sizes, &desc, &s.StampLine1, &s.StampLine2, &s.PhotoCount, &created, &purged,
			&s.StampedCount, &s.FailedCount, &s.InFlight); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(sizes), &s.Sizes); err != nil {
			return nil, err
		}
		if desc.Valid {
			s.Description = &desc.String
		}
		if s.CreatedAt, err = ParseTime(created); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteBatch removes the batch row (photos and jobs cascade).
func (d *DB) DeleteBatch(ctx context.Context, id string) error {
	res, err := d.W.ExecContext(ctx, `DELETE FROM batches WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkUploaded moves a photo from awaiting_upload to uploaded and enqueues
// its process job, atomically.
func (d *DB) MarkUploaded(ctx context.Context, photoID string, bytes int64, now time.Time) error {
	tx, err := d.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `UPDATE photos SET status = ?, bytes = ?, failed_step = NULL, error_code = NULL, updated_at = ? WHERE id = ? AND status = ?`,
		StatusUploaded, bytes, FormatTime(now), photoID, StatusAwaitingUpload)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrInvalidState
	}
	if err := enqueue(ctx, tx, photoID, now); err != nil {
		return err
	}
	return tx.Commit()
}

// ResetForUpload puts a photo back to awaiting_upload when it is still
// waiting or has failed in the upload step.
func (d *DB) ResetForUpload(ctx context.Context, photoID string, now time.Time) error {
	res, err := d.W.ExecContext(ctx, `UPDATE photos SET status = ?, failed_step = NULL, error_code = NULL, updated_at = ?
		WHERE id = ? AND (status = ? OR (status = ? AND failed_step = ?))`,
		StatusAwaitingUpload, FormatTime(now), photoID, StatusAwaitingUpload, StatusFailed, StepUpload)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrInvalidState
	}
	return nil
}

// MarkUploadFailed marks an awaiting_upload photo as failed in the upload step.
func (d *DB) MarkUploadFailed(ctx context.Context, photoID, code string, now time.Time) error {
	res, err := d.W.ExecContext(ctx, `UPDATE photos SET status = ?, failed_step = ?, error_code = ?, updated_at = ? WHERE id = ? AND status = ?`,
		StatusFailed, StepUpload, code, FormatTime(now), photoID, StatusAwaitingUpload)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrInvalidState
	}
	return nil
}

// RetryPhoto re-queues a photo that failed in prepare or stamp.
func (d *DB) RetryPhoto(ctx context.Context, photoID string, now time.Time) error {
	tx, err := d.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `UPDATE photos SET status = ?, failed_step = NULL, error_code = NULL, updated_at = ?
		WHERE id = ? AND status = ? AND failed_step IN (?, ?)`,
		StatusUploaded, FormatTime(now), photoID, StatusFailed, StepPrepare, StepStamp)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrInvalidState
	}
	if err := enqueue(ctx, tx, photoID, now); err != nil {
		return err
	}
	return tx.Commit()
}

// SetPhotoPrepared records the prepare step result.
func (d *DB) SetPhotoPrepared(ctx context.Context, photoID, thumbKey string, w, h int, now time.Time) error {
	_, err := d.W.ExecContext(ctx, `UPDATE photos SET status = ?, thumb_key = ?, width = ?, height = ?, updated_at = ? WHERE id = ?`,
		StatusPrepared, thumbKey, w, h, FormatTime(now), photoID)
	return err
}

// SetPhotoStamped records the stamp step result.
func (d *DB) SetPhotoStamped(ctx context.Context, photoID, stampedKey string, now time.Time) error {
	_, err := d.W.ExecContext(ctx, `UPDATE photos SET status = ?, stamped_key = ?, failed_step = NULL, error_code = NULL, updated_at = ? WHERE id = ?`,
		StatusStamped, stampedKey, FormatTime(now), photoID)
	return err
}

// SetPhotoFailed marks a photo as failed at step with code.
func (d *DB) SetPhotoFailed(ctx context.Context, photoID, step, code string, now time.Time) error {
	_, err := d.W.ExecContext(ctx, `UPDATE photos SET status = ?, failed_step = ?, error_code = ?, updated_at = ? WHERE id = ?`,
		StatusFailed, step, code, FormatTime(now), photoID)
	return err
}

// ExpireAwaitingUploads fails photos waiting for upload since before cutoff.
func (d *DB) ExpireAwaitingUploads(ctx context.Context, cutoff, now time.Time) (int64, error) {
	res, err := d.W.ExecContext(ctx, `UPDATE photos SET status = ?, failed_step = ?, error_code = 'upload_expired', updated_at = ?
		WHERE status = ? AND updated_at < ?`,
		StatusFailed, StepUpload, FormatTime(now), StatusAwaitingUpload, FormatTime(cutoff))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// BatchesToPurgeOriginals lists batches created before cutoff whose originals
// and thumbnails were not removed yet.
func (d *DB) BatchesToPurgeOriginals(ctx context.Context, cutoff time.Time) ([]string, error) {
	return d.queryIDs(ctx, `SELECT id FROM batches WHERE created_at < ? AND originals_purged_at IS NULL ORDER BY created_at`, FormatTime(cutoff))
}

// MarkOriginalsPurged records that originals and thumbnails were removed.
func (d *DB) MarkOriginalsPurged(ctx context.Context, batchID string, now time.Time) error {
	_, err := d.W.ExecContext(ctx, `UPDATE batches SET originals_purged_at = ? WHERE id = ?`, FormatTime(now), batchID)
	return err
}

// BatchesOlderThan lists batches created before cutoff.
func (d *DB) BatchesOlderThan(ctx context.Context, cutoff time.Time) ([]string, error) {
	return d.queryIDs(ctx, `SELECT id FROM batches WHERE created_at < ? ORDER BY created_at`, FormatTime(cutoff))
}

func (d *DB) queryIDs(ctx context.Context, q string, args ...any) ([]string, error) {
	rows, err := d.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
