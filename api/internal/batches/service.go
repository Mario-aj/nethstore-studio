// Package batches holds the batch and photo use cases: validation, creation
// with upload policies, upload confirmation, retries and progress.
package batches

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/nethstore/estudio/api/internal/stamp"
	"github.com/nethstore/estudio/api/internal/storage"
	"github.com/nethstore/estudio/api/internal/store"
)

// MaxOpenBatches is how many batches may have photos awaiting upload.
const MaxOpenBatches = 5

// ValidationError is a 400 with a stable code.
type ValidationError struct {
	Code    string
	Message string
}

func (e *ValidationError) Error() string { return e.Code + ": " + e.Message }

// Errors mapped by the HTTP layer.
var (
	ErrNotFound           = errors.New("not found")
	ErrNotReady           = errors.New("not ready")
	ErrInvalidState       = errors.New("invalid state")
	ErrObjectMissing      = errors.New("object missing")
	ErrInvalidObjectSize  = errors.New("invalid object size")
	ErrTooManyOpenBatches = errors.New("too many open batches")
)

// Storage is the subset of the object store the use cases need.
type Storage interface {
	PresignUpload(ctx context.Context, key string, now time.Time) (storage.Upload, error)
	Head(ctx context.Context, key string) (int64, error)
	DeletePrefix(ctx context.Context, prefix string) error
}

// Service implements the batch use cases.
type Service struct {
	DB        *store.DB
	Storage   Storage
	Now       func() time.Time
	MaxPhotos int
	MinBytes  int64
	MaxBytes  int64
	// Notify wakes the workers after a job is enqueued.
	Notify func()
}

// CreateInput is a validated creation request.
type CreateInput struct {
	PriceKz     int64
	Sizes       []string
	Description string
	PhotoCount  int
}

type createBody struct {
	PriceKz     json.RawMessage `json:"priceKz"`
	Sizes       []string        `json:"sizes"`
	Description *string         `json:"description"`
	PhotoCount  json.RawMessage `json:"photoCount"`
}

// jsonInt accepts only a plain JSON integer literal (no strings, fractions or
// exponents).
func jsonInt(raw json.RawMessage) (int64, bool) {
	n, err := strconv.ParseInt(string(raw), 10, 64)
	return n, err == nil
}

// ParseCreate decodes and validates the POST /api/batches body.
func ParseCreate(body []byte, maxPhotos int) (CreateInput, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	var b createBody
	if err := dec.Decode(&b); err != nil {
		return CreateInput{}, &ValidationError{"invalid_json", "body must be a JSON object with known fields"}
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return CreateInput{}, &ValidationError{"invalid_json", "body must contain a single JSON object"}
	}
	price, ok := jsonInt(b.PriceKz)
	if !ok || stamp.ValidatePrice(price) != nil {
		return CreateInput{}, &ValidationError{"invalid_price", "price must be between 1 and 9999999"}
	}
	sizes, err := stamp.NormalizeSizes(b.Sizes)
	if err != nil {
		return CreateInput{}, &ValidationError{"invalid_sizes", err.Error()}
	}
	desc := ""
	if b.Description != nil {
		if desc, err = stamp.NormalizeDescription(*b.Description); err != nil {
			return CreateInput{}, &ValidationError{"invalid_description", err.Error()}
		}
	}
	count, ok := jsonInt(b.PhotoCount)
	if !ok || count < 1 || count > int64(maxPhotos) {
		return CreateInput{}, &ValidationError{"invalid_photo_count", fmt.Sprintf("photoCount must be between 1 and %d", maxPhotos)}
	}
	return CreateInput{PriceKz: price, Sizes: sizes, Description: desc, PhotoCount: int(count)}, nil
}

// Keys for a photo's objects (always built by the server).
func OriginalKey(batchID, photoID string) string {
	return "originals/" + batchID + "/" + photoID + ".jpg"
}

// ThumbKey is the thumbnail object key.
func ThumbKey(batchID, photoID string) string { return "thumbs/" + batchID + "/" + photoID + ".jpg" }

// StampedKey is the final object key.
func StampedKey(batchID, photoID string) string { return "stamped/" + batchID + "/" + photoID + ".jpg" }

// CreatedPhoto is a photo with its upload policy.
type CreatedPhoto struct {
	ID       string         `json:"id"`
	Position int            `json:"position"`
	Upload   storage.Upload `json:"upload"`
}

// Created is the 201 response.
type Created struct {
	ID         string         `json:"id"`
	Seq        int64          `json:"seq"`
	StampLine1 string         `json:"stampLine1"`
	StampLine2 string         `json:"stampLine2"`
	Photos     []CreatedPhoto `json:"photos"`
}

// Create stores a batch and returns one upload policy per photo.
func (s *Service) Create(ctx context.Context, in CreateInput) (Created, error) {
	line1, line2, err := stamp.Lines(in.PriceKz, in.Sizes, in.Description)
	if err != nil {
		return Created{}, &ValidationError{"invalid_sizes", err.Error()}
	}
	now := s.Now().UTC()
	bid, err := uuid.NewV7()
	if err != nil {
		return Created{}, err
	}
	b := store.Batch{
		ID: bid.String(), PriceKz: in.PriceKz, Sizes: in.Sizes,
		StampLine1: line1, StampLine2: line2, PhotoCount: in.PhotoCount, CreatedAt: now,
	}
	if in.Description != "" {
		d := in.Description
		b.Description = &d
	}
	photos := make([]store.Photo, in.PhotoCount)
	for i := range photos {
		pid, err := uuid.NewV7()
		if err != nil {
			return Created{}, err
		}
		photos[i] = store.Photo{ID: pid.String(), BatchID: b.ID, Position: i + 1, OriginalKey: OriginalKey(b.ID, pid.String()), CreatedAt: now}
	}
	// Sign before writing, so a storage failure leaves nothing behind.
	out := Created{ID: b.ID, StampLine1: line1, StampLine2: line2, Photos: make([]CreatedPhoto, len(photos))}
	for i, p := range photos {
		up, err := s.Storage.PresignUpload(ctx, p.OriginalKey, now)
		if err != nil {
			return Created{}, err
		}
		out.Photos[i] = CreatedPhoto{ID: p.ID, Position: p.Position, Upload: up}
	}
	if err := s.DB.CreateBatch(ctx, &b, photos, MaxOpenBatches); err != nil {
		if errors.Is(err, store.ErrTooManyOpenBatches) {
			return Created{}, ErrTooManyOpenBatches
		}
		return Created{}, err
	}
	out.Seq = b.Seq
	return out, nil
}

// PhotoView is a photo in the batch detail.
type PhotoView struct {
	ID         string  `json:"id"`
	Position   int     `json:"position"`
	Status     string  `json:"status"`
	FailedStep *string `json:"failedStep"`
	ErrorCode  *string `json:"errorCode"`
}

// Detail is the GET /api/batches/{id} response.
type Detail struct {
	ID          string      `json:"id"`
	Seq         int64       `json:"seq"`
	PriceKz     int64       `json:"priceKz"`
	Sizes       []string    `json:"sizes"`
	Description *string     `json:"description"`
	StampLine1  string      `json:"stampLine1"`
	StampLine2  string      `json:"stampLine2"`
	PhotoCount  int         `json:"photoCount"`
	CreatedAt   time.Time   `json:"createdAt"`
	Steps       Steps       `json:"steps"`
	FailedCount int         `json:"failedCount"`
	Finished    bool        `json:"finished"`
	Photos      []PhotoView `json:"photos"`
}

// Get returns the batch with computed progress.
func (s *Service) Get(ctx context.Context, id string) (Detail, error) {
	b, err := s.DB.GetBatch(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	photos, err := s.DB.PhotosByBatch(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	pr := ComputeProgress(photos)
	d := Detail{
		ID: b.ID, Seq: b.Seq, PriceKz: b.PriceKz, Sizes: b.Sizes, Description: b.Description,
		StampLine1: b.StampLine1, StampLine2: b.StampLine2, PhotoCount: b.PhotoCount, CreatedAt: b.CreatedAt,
		Steps: pr.Steps, FailedCount: pr.FailedCount, Finished: pr.Finished, Photos: make([]PhotoView, len(photos)),
	}
	for i, p := range photos {
		d.Photos[i] = PhotoView{ID: p.ID, Position: p.Position, Status: p.Status, FailedStep: p.FailedStep, ErrorCode: p.ErrorCode}
	}
	return d, nil
}

// Summary is one item of GET /api/batches.
type Summary struct {
	ID           string    `json:"id"`
	Seq          int64     `json:"seq"`
	PriceKz      int64     `json:"priceKz"`
	Sizes        []string  `json:"sizes"`
	Description  *string   `json:"description"`
	StampLine1   string    `json:"stampLine1"`
	StampLine2   string    `json:"stampLine2"`
	PhotoCount   int       `json:"photoCount"`
	StampedCount int       `json:"stampedCount"`
	FailedCount  int       `json:"failedCount"`
	Finished     bool      `json:"finished"`
	CreatedAt    time.Time `json:"createdAt"`
	// CoverPhotoID is the first stamped photo, shown as the batch thumbnail; null while none is stamped.
	CoverPhotoID *string `json:"coverPhotoId"`
}

// Page is the body of GET /api/batches.
type Page struct {
	Batches []Summary `json:"batches"`
	// NextBefore is the `before` value for the next (older) page, null on the last page.
	NextBefore *int64 `json:"nextBefore"`
}

// List returns up to limit batches, newest first. With before > 0 it starts at the
// batch just older than seq `before`.
func (s *Service) List(ctx context.Context, limit int, before int64) (Page, error) {
	if limit < 1 {
		return Page{Batches: []Summary{}}, nil
	}
	// One extra row tells whether an older page exists without a second query.
	rows, err := s.DB.ListBatches(ctx, limit+1, before)
	if err != nil {
		return Page{}, err
	}
	page := Page{Batches: make([]Summary, 0, min(len(rows), limit))}
	for i, r := range rows {
		if i == limit {
			last := page.Batches[limit-1].Seq
			page.NextBefore = &last
			break
		}
		page.Batches = append(page.Batches, Summary{
			ID: r.ID, Seq: r.Seq, PriceKz: r.PriceKz, Sizes: r.Sizes, Description: r.Description,
			StampLine1: r.StampLine1, StampLine2: r.StampLine2, PhotoCount: r.PhotoCount,
			StampedCount: r.StampedCount, FailedCount: r.FailedCount, Finished: r.InFlight == 0, CreatedAt: r.CreatedAt,
			CoverPhotoID: r.CoverPhotoID,
		})
	}
	return page, nil
}

// Delete removes a batch, its rows and its objects.
func (s *Service) Delete(ctx context.Context, id string) error {
	if _, err := s.DB.GetBatch(ctx, id); errors.Is(err, store.ErrNotFound) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := DeleteObjects(ctx, s.Storage, id); err != nil {
		return err
	}
	if err := s.DB.DeleteBatch(ctx, id); errors.Is(err, store.ErrNotFound) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	return nil
}

// DeleteObjects removes every object of a batch.
func DeleteObjects(ctx context.Context, st Storage, batchID string) error {
	for _, prefix := range []string{"originals/", "thumbs/", "stamped/"} {
		if err := st.DeletePrefix(ctx, prefix+batchID+"/"); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) photo(ctx context.Context, id string) (store.Photo, error) {
	p, err := s.DB.GetPhoto(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return p, ErrNotFound
	}
	return p, err
}

func mapState(err error) error {
	if errors.Is(err, store.ErrInvalidState) {
		return ErrInvalidState
	}
	return err
}

// ConfirmUpload checks the object and enqueues processing.
func (s *Service) ConfirmUpload(ctx context.Context, photoID string) error {
	p, err := s.photo(ctx, photoID)
	if err != nil {
		return err
	}
	if p.Status != store.StatusAwaitingUpload {
		return ErrInvalidState
	}
	size, err := s.Storage.Head(ctx, p.OriginalKey)
	if errors.Is(err, storage.ErrNotFound) {
		return ErrObjectMissing
	}
	if err != nil {
		return err
	}
	if size < s.MinBytes || size > s.MaxBytes {
		return ErrInvalidObjectSize
	}
	if err := s.DB.MarkUploaded(ctx, photoID, size, s.Now().UTC()); err != nil {
		return mapState(err)
	}
	if s.Notify != nil {
		s.Notify()
	}
	return nil
}

// UploadSlot issues a fresh policy for a photo still awaiting upload or that
// failed to upload.
func (s *Service) UploadSlot(ctx context.Context, photoID string) (storage.Upload, error) {
	p, err := s.photo(ctx, photoID)
	if err != nil {
		return storage.Upload{}, err
	}
	now := s.Now().UTC()
	up, err := s.Storage.PresignUpload(ctx, p.OriginalKey, now)
	if err != nil {
		return storage.Upload{}, err
	}
	if err := s.DB.ResetForUpload(ctx, photoID, now); err != nil {
		return storage.Upload{}, mapState(err)
	}
	return up, nil
}

// UploadFailed records that the app gave up uploading a photo.
func (s *Service) UploadFailed(ctx context.Context, photoID string) error {
	if _, err := s.photo(ctx, photoID); err != nil {
		return err
	}
	return mapState(s.DB.MarkUploadFailed(ctx, photoID, "upload_failed", s.Now().UTC()))
}

// Retry re-queues a photo that failed in prepare or stamp.
func (s *Service) Retry(ctx context.Context, photoID string) error {
	if _, err := s.photo(ctx, photoID); err != nil {
		return err
	}
	if err := s.DB.RetryPhoto(ctx, photoID, s.Now().UTC()); err != nil {
		return mapState(err)
	}
	if s.Notify != nil {
		s.Notify()
	}
	return nil
}

// ImageRef locates a photo image for download.
type ImageRef struct {
	Key      string
	Filename string
}

// Thumb returns the thumbnail key, falling back to the stamped image when the
// thumbnail was removed by retention.
func (s *Service) Thumb(ctx context.Context, photoID string) (ImageRef, []string, error) {
	p, err := s.photo(ctx, photoID)
	if err != nil {
		return ImageRef{}, nil, err
	}
	var keys []string
	if p.ThumbKey != nil {
		keys = append(keys, *p.ThumbKey)
	}
	if p.StampedKey != nil && p.Status == store.StatusStamped {
		keys = append(keys, *p.StampedKey)
	}
	if len(keys) == 0 {
		return ImageRef{}, nil, ErrNotReady
	}
	return ImageRef{Key: keys[0]}, keys[1:], nil
}

// Stamped returns the final image key and download filename.
func (s *Service) Stamped(ctx context.Context, photoID string) (ImageRef, error) {
	p, err := s.photo(ctx, photoID)
	if err != nil {
		return ImageRef{}, err
	}
	if p.Status != store.StatusStamped || p.StampedKey == nil {
		return ImageRef{}, ErrNotReady
	}
	b, err := s.DB.GetBatch(ctx, p.BatchID)
	if err != nil {
		return ImageRef{}, err
	}
	return ImageRef{Key: *p.StampedKey, Filename: fmt.Sprintf("nethstore-%03d-%03d.jpg", b.Seq, p.Position)}, nil
}
