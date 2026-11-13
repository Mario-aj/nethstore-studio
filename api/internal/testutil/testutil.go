// Package testutil has helpers shared by tests: an in-memory database, an
// in-memory object store, a controllable clock and synthetic images.
package testutil

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nethstore/estudio/api/internal/storage"
	"github.com/nethstore/estudio/api/internal/store"
)

// DB opens a migrated private in-memory database closed with the test.
func DB(t testing.TB) *store.DB {
	t.Helper()
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	db, err := store.OpenMemory("test-" + hex.EncodeToString(b))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return db
}

// Clock is a manual clock.
type Clock struct {
	mu sync.Mutex
	t  time.Time
}

// NewClock starts at a fixed instant.
func NewClock() *Clock { return &Clock{t: time.Date(2026, 11, 13, 19, 0, 0, 0, time.UTC)} }

// Now returns the current fake time.
func (c *Clock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }

// Advance moves the clock forward.
func (c *Clock) Advance(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

// Logger returns a JSON logger writing to w (or discarding).
func Logger(w io.Writer) *slog.Logger {
	if w == nil {
		w = io.Discard
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// MemStorage is an in-memory object store implementing the storage methods
// used by the app. Fail* fields inject errors.
type MemStorage struct {
	mu      sync.Mutex
	Objects map[string][]byte
	// FailPut / FailRead make the next N calls fail with a transient error.
	FailPut  int
	FailRead int
	Presigns int
}

// NewMemStorage returns an empty store.
func NewMemStorage() *MemStorage { return &MemStorage{Objects: map[string][]byte{}} }

// ErrTransient is the injected failure.
var ErrTransient = fmt.Errorf("injected storage failure")

// PresignUpload returns a fake policy.
func (m *MemStorage) PresignUpload(_ context.Context, key string, now time.Time) (storage.Upload, error) {
	m.mu.Lock()
	m.Presigns++
	m.mu.Unlock()
	return storage.Upload{
		URL: "/s3/estudio",
		Fields: map[string]string{ // #nosec G101 -- fake values for tests
			"key": key, "Content-Type": "image/jpeg", "policy": "cG9saWN5", "x-amz-algorithm": "AWS4-HMAC-SHA256",
			"x-amz-credential": "GK/20261113/garage/s3/aws4_request", "x-amz-date": now.UTC().Format("20060102T150405Z"), "x-amz-signature": "00",
		},
		ExpiresAt: now.Add(15 * time.Minute),
	}, nil
}

// Put stores an object directly (simulates a browser upload).
func (m *MemStorage) Put(key string, data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Objects[key] = append([]byte(nil), data...)
}

// Has reports whether key exists.
func (m *MemStorage) Has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.Objects[key]
	return ok
}

// Bytes returns an object's data.
func (m *MemStorage) Bytes(key string) []byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Objects[key]
}

// Keys lists keys with prefix, sorted.
func (m *MemStorage) Keys(prefix string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for k := range m.Objects {
		if strings.HasPrefix(k, prefix) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// Head returns the size of key.
func (m *MemStorage) Head(_ context.Context, key string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.Objects[key]
	if !ok {
		return 0, storage.ErrNotFound
	}
	return int64(len(d)), nil
}

// Get streams key.
func (m *MemStorage) Get(_ context.Context, key string) (storage.Object, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.Objects[key]
	if !ok {
		return storage.Object{}, storage.ErrNotFound
	}
	return storage.Object{Body: io.NopCloser(bytes.NewReader(d)), Size: int64(len(d))}, nil
}

// ReadAll reads key up to limit.
func (m *MemStorage) ReadAll(_ context.Context, key string, limit int64) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailRead > 0 {
		m.FailRead--
		return nil, ErrTransient
	}
	d, ok := m.Objects[key]
	if !ok {
		return nil, storage.ErrNotFound
	}
	if int64(len(d)) > limit {
		return nil, fmt.Errorf("too large")
	}
	return append([]byte(nil), d...), nil
}

// PutJPEG writes key.
func (m *MemStorage) PutJPEG(_ context.Context, key string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailPut > 0 {
		m.FailPut--
		return ErrTransient
	}
	m.Objects[key] = append([]byte(nil), data...)
	return nil
}

// DeletePrefix removes keys under prefix.
func (m *MemStorage) DeletePrefix(_ context.Context, prefix string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k := range m.Objects {
		if strings.HasPrefix(k, prefix) {
			delete(m.Objects, k)
		}
	}
	return nil
}

// JPEG returns a synthetic JPEG of w x h filled with a gradient of c.
func JPEG(t testing.TB, w, h int, c color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			f := 0.85 + 0.15*float64(x+y)/float64(w+h)
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(float64(c.R) * f), G: uint8(float64(c.G) * f), B: uint8(float64(c.B) * f), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
