//go:build integration

package storage_test

import (
	"bytes"
	"context"
	"fmt"
	"image/color"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/jobs"
	"github.com/nethstore/estudio/api/internal/stamp"
	"github.com/nethstore/estudio/api/internal/storage"
	"github.com/nethstore/estudio/api/internal/testutil"
)

func endpoint(t *testing.T) string {
	e := os.Getenv("S3_TEST_ENDPOINT")
	if e == "" {
		t.Skip("S3_TEST_ENDPOINT not set (run make test-integration)")
	}
	return e
}

func newStorage(t *testing.T, mod func(*storage.Config)) *storage.Storage {
	cfg := storage.Config{
		Endpoint: endpoint(t), Region: "garage", Bucket: os.Getenv("S3_BUCKET"),
		AccessKeyID: os.Getenv("S3_ACCESS_KEY_ID"), SecretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY"),
		UploadPath: "/s3/estudio", MaxUploadBytes: 15 << 20,
	}
	if cfg.Bucket == "" {
		cfg.Bucket = "estudio"
	}
	if mod != nil {
		mod(&cfg)
	}
	return storage.New(cfg)
}

// post sends the browser form straight to Garage (the Caddy prefix is
// stripped in production), with the file as the last part.
func post(t *testing.T, up storage.Upload, override map[string]string, extra map[string]string, file []byte) (int, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fields := map[string]string{}
	for k, v := range up.Fields {
		fields[k] = v
	}
	for k, v := range override {
		fields[k] = v
	}
	for k, v := range extra {
		fields[k] = v
	}
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		_ = mw.WriteField(k, fields[k])
	}
	fw, _ := mw.CreateFormFile("file", "photo.jpg")
	_, _ = fw.Write(file)
	_ = mw.Close()
	url := endpoint(t) + "/estudio"
	req, _ := http.NewRequest(http.MethodPost, url, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

func uniqueKey(prefix string) string {
	return fmt.Sprintf("%s/%d/photo.jpg", prefix, time.Now().UnixNano())
}

// SPEC 8: what the POST policy must accept and refuse against a real Garage.
func TestPostPolicyAgainstGarage(t *testing.T) {
	ctx := context.Background()
	s := newStorage(t, nil)
	if err := s.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	jpg := testutil.JPEG(t, 400, 600, color.NRGBA{R: 200, G: 150, B: 100, A: 255})

	t.Run("valid upload accepted", func(t *testing.T) {
		key := uniqueKey("originals/it")
		up, err := s.PresignUpload(ctx, key, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		code, body := post(t, up, nil, nil, jpg)
		if code != http.StatusNoContent && code != http.StatusOK {
			t.Fatalf("status %d: %s", code, body)
		}
		size, err := s.Head(ctx, key)
		if err != nil || size != int64(len(jpg)) {
			t.Fatalf("head %d %v", size, err)
		}
	})

	t.Run("too large rejected", func(t *testing.T) {
		small := newStorage(t, func(c *storage.Config) { c.MaxUploadBytes = 2048 })
		key := uniqueKey("originals/it")
		up, _ := small.PresignUpload(ctx, key, time.Now())
		if code, body := post(t, up, nil, nil, bytes.Repeat([]byte{0xFF}, 4096)); code < 400 {
			t.Fatalf("accepted (%d) %s", code, body)
		}
		if _, err := s.Head(ctx, key); err == nil {
			t.Fatal("object stored")
		}
	})

	t.Run("too small rejected", func(t *testing.T) {
		key := uniqueKey("originals/it")
		up, _ := s.PresignUpload(ctx, key, time.Now())
		if code, body := post(t, up, nil, nil, []byte("tiny")); code < 400 {
			t.Fatalf("accepted (%d) %s", code, body)
		}
	})

	t.Run("other content type rejected", func(t *testing.T) {
		key := uniqueKey("originals/it")
		up, _ := s.PresignUpload(ctx, key, time.Now())
		if code, body := post(t, up, map[string]string{"Content-Type": "image/png"}, nil, jpg); code < 400 {
			t.Fatalf("accepted (%d) %s", code, body)
		}
	})

	t.Run("other key rejected", func(t *testing.T) {
		key := uniqueKey("originals/it")
		up, _ := s.PresignUpload(ctx, key, time.Now())
		other := uniqueKey("stamped/evil")
		if code, body := post(t, up, map[string]string{"key": other}, nil, jpg); code < 400 {
			t.Fatalf("accepted (%d) %s", code, body)
		}
		if _, err := s.Head(ctx, other); err == nil {
			t.Fatal("object stored under another key")
		}
	})

	t.Run("expired policy rejected", func(t *testing.T) {
		expired := newStorage(t, func(c *storage.Config) { c.PolicyTTL = -time.Minute })
		key := uniqueKey("originals/it")
		up, _ := expired.PresignUpload(ctx, key, time.Now())
		if code, body := post(t, up, nil, nil, jpg); code < 400 {
			t.Fatalf("accepted (%d) %s", code, body)
		}
	})

	t.Run("field outside policy rejected", func(t *testing.T) {
		key := uniqueKey("originals/it")
		up, _ := s.PresignUpload(ctx, key, time.Now())
		if code, body := post(t, up, nil, map[string]string{"x-amz-meta-evil": "1"}, jpg); code < 400 {
			t.Fatalf("accepted (%d) %s", code, body)
		}
	})

	t.Run("tampered signature rejected", func(t *testing.T) {
		key := uniqueKey("originals/it")
		up, _ := s.PresignUpload(ctx, key, time.Now())
		if code, body := post(t, up, map[string]string{"x-amz-signature": "00" + up.Fields["x-amz-signature"][2:]}, nil, jpg); code < 400 {
			t.Fatalf("accepted (%d) %s", code, body)
		}
	})
}

func TestObjectOperations(t *testing.T) {
	ctx := context.Background()
	s := newStorage(t, nil)
	prefix := fmt.Sprintf("thumbs/ops-%d/", time.Now().UnixNano())
	data := bytes.Repeat([]byte("abc"), 1000)
	for i := range 3 {
		if err := s.PutJPEG(ctx, fmt.Sprintf("%s%d.jpg", prefix, i), data); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.ReadAll(ctx, prefix+"0.jpg", 1<<20)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("read %d %v", len(got), err)
	}
	if _, err := s.ReadAll(ctx, prefix+"0.jpg", 10); err == nil {
		t.Fatal("limit ignored")
	}
	obj, err := s.Get(ctx, prefix+"1.jpg")
	if err != nil || obj.Size != int64(len(data)) {
		t.Fatalf("get %v %v", obj.Size, err)
	}
	_ = obj.Body.Close()
	if err := s.Delete(ctx, prefix+"2.jpg"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, prefix+"missing.jpg"); err != nil {
		t.Fatalf("delete missing: %v", err)
	}
	if err := s.DeletePrefix(ctx, prefix); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"0.jpg", "1.jpg"} {
		if _, err := s.Head(ctx, prefix+k); err == nil {
			t.Fatalf("%s survived", k)
		}
	}
	if _, err := s.Get(ctx, prefix+"0.jpg"); err == nil {
		t.Fatal("get after delete")
	}
	if _, err := s.ReadAll(ctx, prefix+"0.jpg", 10); err == nil {
		t.Fatal("readall after delete")
	}
	bad := newStorage(t, func(c *storage.Config) { c.SecretAccessKey = "wrong" })
	if err := bad.Ping(ctx); err == nil {
		t.Fatal("wrong credentials accepted")
	}
}

// End to end inside the server: create a batch, upload through the POST
// policy, confirm, process and read the stamped image back.
func TestBatchProcessedAgainstGarage(t *testing.T) {
	ctx := context.Background()
	s := newStorage(t, nil)
	db := testutil.DB(t)
	log := testutil.Logger(nil)
	proc := &jobs.Processor{DB: db, Storage: s, MaxBytes: 15 << 20, Layout: stamp.DefaultLayout(), Now: time.Now, Log: log}
	pool := jobs.NewPool(db, proc, 2, log)
	bs := &batches.Service{DB: db, Storage: s, Now: time.Now, MaxPhotos: 50, MinBytes: 1024, MaxBytes: 15 << 20, Notify: pool.Notify}

	out, err := bs.Create(ctx, batches.CreateInput{PriceKz: 8000, Sizes: []string{"S", "M"}, Description: "Veste", PhotoCount: 4})
	if err != nil {
		t.Fatal(err)
	}
	for i, p := range out.Photos {
		jpg := testutil.JPEG(t, 1200+i*100, 1600, color.NRGBA{R: uint8(40 * i), G: 120, B: 200, A: 255})
		if code, body := post(t, p.Upload, nil, nil, jpg); code >= 300 {
			t.Fatalf("upload %d: %d %s", i, code, body)
		}
		if err := bs.ConfirmUpload(ctx, p.ID); err != nil {
			t.Fatal(err)
		}
	}
	for pool.RunOnce() {
	}
	d, err := bs.Get(ctx, out.ID)
	if err != nil || !d.Finished || d.FailedCount != 0 || d.Steps.Ready.State != "completed" {
		t.Fatalf("batch %+v %v", d.Steps, err)
	}
	ref, err := bs.Stamped(ctx, out.Photos[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	data, err := s.ReadAll(ctx, ref.Key, 15<<20)
	if err != nil || len(data) < 1024 || bytes.Contains(data, []byte("Exif")) {
		t.Fatalf("stamped %d %v", len(data), err)
	}
	if err := bs.Delete(ctx, out.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Head(ctx, ref.Key); err == nil {
		t.Fatal("stamped object survived delete")
	}
}
