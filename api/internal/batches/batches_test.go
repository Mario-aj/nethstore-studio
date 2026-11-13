package batches

import (
	"context"
	"errors"
	"image/color"
	"strings"
	"testing"

	"github.com/nethstore/estudio/api/internal/store"
	"github.com/nethstore/estudio/api/internal/testutil"
)

func TestParseCreate(t *testing.T) {
	in, err := ParseCreate([]byte(`{"priceKz":10000,"sizes":["L","M"],"description":"  Veste ","photoCount":12}`), 50)
	if err != nil {
		t.Fatal(err)
	}
	if in.PriceKz != 10000 || strings.Join(in.Sizes, ",") != "M,L" || in.Description != "Veste" || in.PhotoCount != 12 {
		t.Fatalf("got %+v", in)
	}
	if in, err := ParseCreate([]byte(`{"priceKz":1,"sizes":["M"],"description":null,"photoCount":1}`), 50); err != nil || in.Description != "" {
		t.Fatalf("null description: %+v %v", in, err)
	}
	cases := map[string]string{
		`{"priceKz":0,"sizes":["M"],"photoCount":1}`:                       "invalid_price",
		`{"priceKz":10000000,"sizes":["M"],"photoCount":1}`:                "invalid_price",
		`{"priceKz":10.5,"sizes":["M"],"photoCount":1}`:                    "invalid_price",
		`{"priceKz":"10","sizes":["M"],"photoCount":1}`:                    "invalid_price",
		`{"priceKz":1e3,"sizes":["M"],"photoCount":1}`:                     "invalid_price",
		`{"sizes":["M"],"photoCount":1}`:                                   "invalid_price",
		`{"priceKz":10,"sizes":["M"],"photoCount":"2"}`:                    "invalid_photo_count",
		`{"priceKz":100,"sizes":[],"photoCount":1}`:                        "invalid_sizes",
		`{"priceKz":100,"sizes":["M","M"],"photoCount":1}`:                 "invalid_sizes",
		`{"priceKz":100,"sizes":["XXL"],"photoCount":1}`:                   "invalid_sizes",
		`{"priceKz":100,"sizes":["M"],"description":"a/b","photoCount":1}`: "invalid_description",
		`{"priceKz":100,"sizes":["M"],"photoCount":0}`:                     "invalid_photo_count",
		`{"priceKz":100,"sizes":["M"],"photoCount":51}`:                    "invalid_photo_count",
		`{"priceKz":100,"sizes":["M"],"photoCount":1,"extra":true}`:        "invalid_json",
		`{"priceKz":100,"sizes":["M"],"photoCount":1}{}`:                   "invalid_json",
		`not json`: "invalid_json",
	}
	for body, code := range cases {
		_, err := ParseCreate([]byte(body), 50)
		var ve *ValidationError
		if !errors.As(err, &ve) || ve.Code != code {
			t.Errorf("%s: err = %v, want %s", body, err, code)
		}
	}
}

func FuzzParseCreate(f *testing.F) {
	f.Add([]byte(`{"priceKz":10000,"sizes":["L","M"],"description":"Veste","photoCount":12}`))
	f.Add([]byte(`{"priceKz":1e3,"sizes":["2XL"],"photoCount":50}`))
	f.Add([]byte(`{}`))
	f.Fuzz(func(t *testing.T, body []byte) {
		in, err := ParseCreate(body, 50)
		if err != nil {
			return
		}
		if in.PriceKz < 1 || in.PriceKz > 9999999 || in.PhotoCount < 1 || in.PhotoCount > 50 || len(in.Sizes) == 0 || len(in.Sizes) > 6 {
			t.Fatalf("accepted invalid input %+v", in)
		}
		if strings.Contains(in.Description, "/") {
			t.Fatalf("description with slash %q", in.Description)
		}
	})
}

func photo(status string, failedStep string) store.Photo {
	p := store.Photo{Status: status}
	if failedStep != "" {
		p.FailedStep = &failedStep
	}
	return p
}

func photos(spec map[store.Photo]int) []store.Photo {
	var out []store.Photo
	for p, n := range spec {
		for range n {
			out = append(out, p)
		}
	}
	return out
}

func TestComputeProgress(t *testing.T) {
	type want struct {
		upload, prepare, stamp, ready string
		done                          [3]int
		failed                        int
		finished                      bool
	}
	cases := []struct {
		name string
		ph   []store.Photo
		want want
	}{
		{"all waiting upload", photos(map[store.Photo]int{photo("awaiting_upload", ""): 12}),
			want{"loading", "pending", "pending", "pending", [3]int{0, 0, 0}, 0, false}},
		{"uploading 3 of 12", append(photos(map[store.Photo]int{photo("awaiting_upload", ""): 9}), photos(map[store.Photo]int{photo("uploaded", ""): 3})...),
			want{"loading", "loading", "pending", "pending", [3]int{3, 0, 0}, 0, false}},
		{"spec example: stamping 7 of 12, one failed", photos(map[store.Photo]int{photo("stamped", ""): 7, photo("prepared", ""): 4, photo("failed", "stamp"): 1}),
			want{"completed", "completed", "loading", "pending", [3]int{12, 12, 7}, 1, false}},
		{"done with one stamp failure", photos(map[store.Photo]int{photo("stamped", ""): 11, photo("failed", "stamp"): 1}),
			want{"completed", "completed", "error", "completed", [3]int{12, 12, 11}, 1, true}},
		{"upload failure then rest ok", photos(map[store.Photo]int{photo("stamped", ""): 11, photo("failed", "upload"): 1}),
			want{"error", "completed", "completed", "completed", [3]int{11, 11, 11}, 1, true}},
		{"prepare failure", photos(map[store.Photo]int{photo("stamped", ""): 2, photo("failed", "prepare"): 1}),
			want{"completed", "error", "completed", "completed", [3]int{3, 2, 2}, 1, true}},
		{"everything failed", photos(map[store.Photo]int{photo("failed", "upload"): 2}),
			want{"error", "completed", "completed", "error", [3]int{0, 0, 0}, 2, true}},
		{"failed without step", []store.Photo{{Status: "failed"}},
			want{"error", "completed", "completed", "error", [3]int{0, 0, 0}, 1, true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pr := ComputeProgress(c.ph)
			got := want{pr.Steps.Upload.State, pr.Steps.Prepare.State, pr.Steps.Stamp.State, pr.Steps.Ready.State,
				[3]int{*pr.Steps.Upload.Done, *pr.Steps.Prepare.Done, *pr.Steps.Stamp.Done}, pr.FailedCount, pr.Finished}
			if got != c.want {
				t.Fatalf("got  %+v\nwant %+v", got, c.want)
			}
			if *pr.Steps.Upload.Total != len(c.ph) || pr.Steps.Ready.Done != nil {
				t.Fatal("totals wrong")
			}
		})
	}
}

type fixture struct {
	svc   *Service
	st    *testutil.MemStorage
	clock *testutil.Clock
	woken int
}

func newFixture(t *testing.T) *fixture {
	f := &fixture{st: testutil.NewMemStorage(), clock: testutil.NewClock()}
	f.svc = &Service{DB: testutil.DB(t), Storage: f.st, Now: f.clock.Now, MaxPhotos: 50, MinBytes: 1024, MaxBytes: 15 << 20,
		Notify: func() { f.woken++ }}
	return f
}

func (f *fixture) create(t *testing.T, n int) Created {
	t.Helper()
	out, err := f.svc.Create(context.Background(), CreateInput{PriceKz: 10000, Sizes: []string{"M", "L"}, Description: "Veste", PhotoCount: n})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestCreateAndUploadFlow(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	out := f.create(t, 3)
	if out.Seq != 1 || out.StampLine1 != "Veste/ M e L" || out.StampLine2 != "10.000 kz" || len(out.Photos) != 3 {
		t.Fatalf("created %+v", out)
	}
	p := out.Photos[0]
	if p.Upload.URL != "/s3/estudio" || p.Upload.Fields["key"] != OriginalKey(out.ID, p.ID) || p.Position != 1 {
		t.Fatalf("upload %+v", p.Upload)
	}
	if out2 := f.create(t, 1); out2.Seq != 2 {
		t.Fatalf("seq %d", out2.Seq)
	}

	// Confirm without object.
	if err := f.svc.ConfirmUpload(ctx, p.ID); !errors.Is(err, ErrObjectMissing) {
		t.Fatalf("err = %v", err)
	}
	// Too small object.
	f.st.Put(OriginalKey(out.ID, p.ID), []byte("tiny"))
	if err := f.svc.ConfirmUpload(ctx, p.ID); !errors.Is(err, ErrInvalidObjectSize) {
		t.Fatalf("err = %v", err)
	}
	f.st.Put(OriginalKey(out.ID, p.ID), testutil.JPEG(t, 300, 400, color.NRGBA{R: 200, A: 255}))
	if err := f.svc.ConfirmUpload(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if f.woken != 1 {
		t.Fatal("workers not notified")
	}
	if err := f.svc.ConfirmUpload(ctx, p.ID); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("second confirm: %v", err)
	}

	// Give up on photo 2, then ask a new slot for it.
	p2 := out.Photos[1]
	if err := f.svc.UploadFailed(ctx, p2.ID); err != nil {
		t.Fatal(err)
	}
	d, _ := f.svc.Get(ctx, out.ID)
	if d.Photos[1].Status != "failed" || *d.Photos[1].FailedStep != "upload" || *d.Photos[1].ErrorCode != "upload_failed" {
		t.Fatalf("photo 2 %+v", d.Photos[1])
	}
	if err := f.svc.UploadFailed(ctx, p2.ID); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("second upload-failed: %v", err)
	}
	if _, err := f.svc.UploadSlot(ctx, p2.ID); err != nil {
		t.Fatal(err)
	}
	d, _ = f.svc.Get(ctx, out.ID)
	if d.Photos[1].Status != "awaiting_upload" || d.Photos[1].FailedStep != nil {
		t.Fatalf("photo 2 after slot %+v", d.Photos[1])
	}
	// No slot for an uploaded photo.
	if _, err := f.svc.UploadSlot(ctx, p.ID); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("slot for uploaded: %v", err)
	}
	// Retry only for prepare/stamp failures.
	if err := f.svc.Retry(ctx, p.ID); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("retry uploaded: %v", err)
	}
	if err := f.svc.DB.SetPhotoFailed(ctx, p.ID, "stamp", "processing_failed", f.clock.Now()); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Retry(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if ph, _ := f.svc.DB.GetPhoto(ctx, p.ID); ph.Status != "uploaded" {
		t.Fatalf("after retry %s", ph.Status)
	}

	// Not found everywhere.
	missing := "01933f6e-0000-7000-8000-000000000000"
	for name, err := range map[string]error{
		"confirm": f.svc.ConfirmUpload(ctx, missing), "failed": f.svc.UploadFailed(ctx, missing), "retry": f.svc.Retry(ctx, missing),
		"delete": f.svc.Delete(ctx, missing),
	} {
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := f.svc.Get(ctx, missing); !errors.Is(err, ErrNotFound) {
		t.Error(err)
	}
	if _, err := f.svc.UploadSlot(ctx, missing); !errors.Is(err, ErrNotFound) {
		t.Error(err)
	}
}

func TestImagesAndDelete(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	out := f.create(t, 1)
	id := out.Photos[0].ID
	if _, _, err := f.svc.Thumb(ctx, id); !errors.Is(err, ErrNotReady) {
		t.Fatalf("thumb: %v", err)
	}
	if _, err := f.svc.Stamped(ctx, id); !errors.Is(err, ErrNotReady) {
		t.Fatalf("stamped: %v", err)
	}
	_ = f.svc.DB.SetPhotoPrepared(ctx, id, ThumbKey(out.ID, id), 1200, 1600, f.clock.Now())
	_ = f.svc.DB.SetPhotoStamped(ctx, id, StampedKey(out.ID, id), f.clock.Now())
	ref, fb, err := f.svc.Thumb(ctx, id)
	if err != nil || ref.Key != ThumbKey(out.ID, id) || len(fb) != 1 || fb[0] != StampedKey(out.ID, id) {
		t.Fatalf("thumb %+v %v %v", ref, fb, err)
	}
	st, err := f.svc.Stamped(ctx, id)
	if err != nil || st.Filename != "nethstore-001-001.jpg" {
		t.Fatalf("stamped %+v %v", st, err)
	}

	list, err := f.svc.List(ctx, 10)
	if err != nil || len(list) != 1 || list[0].StampedCount != 1 || !list[0].Finished {
		t.Fatalf("list %+v %v", list, err)
	}

	for _, k := range []string{OriginalKey(out.ID, id), ThumbKey(out.ID, id), StampedKey(out.ID, id)} {
		f.st.Put(k, []byte("x"))
	}
	if err := f.svc.Delete(ctx, out.ID); err != nil {
		t.Fatal(err)
	}
	if len(f.st.Keys("")) != 0 {
		t.Fatalf("objects left: %v", f.st.Keys(""))
	}
	if _, err := f.svc.Get(ctx, out.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("batch still there")
	}
}

func TestTooManyOpenBatches(t *testing.T) {
	f := newFixture(t)
	for range MaxOpenBatches {
		f.create(t, 1)
	}
	_, err := f.svc.Create(context.Background(), CreateInput{PriceKz: 1, Sizes: []string{"M"}, PhotoCount: 1})
	if !errors.Is(err, ErrTooManyOpenBatches) {
		t.Fatalf("err = %v", err)
	}
}

func TestValidationErrorString(t *testing.T) {
	if (&ValidationError{"a", "b"}).Error() != "a: b" {
		t.Fatal("format")
	}
}
