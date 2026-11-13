package imaging

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"runtime"
	"testing"

	"github.com/nethstore/estudio/api/internal/testutil"
)

// withEXIFOrientation inserts an APP1 EXIF segment with the given
// orientation (and a fake GPS-looking payload) right after SOI.
func withEXIFOrientation(t *testing.T, jpg []byte, orientation byte) []byte {
	t.Helper()
	tiff := []byte{
		'I', 'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, // header, IFD at 8
		0x01, 0x00, // 1 entry
		0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, // Orientation SHORT
		0x00, 0x00, 0x00, 0x00, // next IFD
	}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	payload = append(payload, []byte("GPS-LATITUDE-8.8383")...)
	seg := []byte{0xFF, 0xE1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	seg = append(seg, payload...)
	out := append([]byte{}, jpg[:2]...)
	out = append(out, seg...)
	return append(out, jpg[2:]...)
}

// withDimensions rewrites the SOF0 frame size without touching the data.
func withDimensions(t *testing.T, jpg []byte, w, h int) []byte {
	t.Helper()
	out := append([]byte{}, jpg...)
	for i := 2; i+9 < len(out); {
		if out[i] != 0xFF {
			t.Fatal("bad marker")
		}
		marker := out[i+1]
		length := int(out[i+2])<<8 | int(out[i+3])
		if marker == 0xC0 || marker == 0xC2 {
			out[i+5], out[i+6] = byte(h>>8), byte(h)
			out[i+7], out[i+8] = byte(w>>8), byte(w)
			return out
		}
		i += 2 + length
	}
	t.Fatal("SOF not found")
	return nil
}

func TestValidate(t *testing.T) {
	ok := testutil.JPEG(t, 300, 400, color.NRGBA{R: 200, G: 180, B: 160, A: 255})
	if _, err := Validate(ok); err != nil {
		t.Fatalf("valid JPEG rejected: %v", err)
	}
	small := testutil.JPEG(t, 150, 400, color.NRGBA{R: 1, A: 255})
	var pngBuf bytes.Buffer
	_ = png.Encode(&pngBuf, image.NewNRGBA(image.Rect(0, 0, 300, 300)))
	cases := map[string][]byte{
		"too small":   small,
		"png as jpg":  pngBuf.Bytes(),
		"text as jpg": []byte("isto não é uma imagem, é texto"),
		"empty":       nil,
		"20000x20000": withDimensions(t, ok, 20000, 20000),
		"8000x8000":   withDimensions(t, ok, 8000, 8000), // 64 MP > 40 MP
	}
	for name, data := range cases {
		if _, err := Validate(data); !errors.Is(err, ErrInvalidImage) {
			t.Errorf("%s: err = %v, want ErrInvalidImage", name, err)
		}
	}
}

// SPEC 12.8 item 10: a huge declared size is refused before decoding, so
// memory stays flat.
func TestNormalizeRefusesHugeWithoutDecoding(t *testing.T) {
	huge := withDimensions(t, testutil.JPEG(t, 300, 300, color.NRGBA{G: 255, A: 255}), 20000, 20000)
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	_, err := Normalize(huge)
	runtime.ReadMemStats(&after)
	if !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("err = %v", err)
	}
	if grew := after.TotalAlloc - before.TotalAlloc; grew > 8<<20 {
		t.Fatalf("allocated %d bytes refusing a header-only check", grew)
	}
}

// SPEC 12.8 item 11.
func TestNormalizeRejectsNonJPEG(t *testing.T) {
	var pngBuf bytes.Buffer
	_ = png.Encode(&pngBuf, image.NewNRGBA(image.Rect(0, 0, 400, 400)))
	for _, data := range [][]byte{pngBuf.Bytes(), []byte("hello")} {
		if _, err := Normalize(data); !errors.Is(err, ErrInvalidImage) {
			t.Errorf("err = %v, want ErrInvalidImage", err)
		}
	}
}

func TestNormalizeOrientationAndSize(t *testing.T) {
	src := withEXIFOrientation(t, testutil.JPEG(t, 2400, 1800, color.NRGBA{R: 90, G: 60, B: 30, A: 255}), 6)
	img, err := Normalize(src)
	if err != nil {
		t.Fatal(err)
	}
	// Orientation 6 rotates 90°: 2400x1800 becomes portrait, then fits 1600.
	if b := img.Bounds(); b.Dx() != 1200 || b.Dy() != 1600 {
		t.Fatalf("size %v, want 1200x1600", b.Size())
	}
	small, err := Normalize(testutil.JPEG(t, 800, 600, color.NRGBA{B: 200, A: 255}))
	if err != nil {
		t.Fatal(err)
	}
	if b := small.Bounds(); b.Dx() != 800 || b.Dy() != 600 {
		t.Fatalf("small image resized to %v; must never enlarge", b.Size())
	}
}

// SPEC 12.8 item 12: the output has no EXIF.
func TestOutputHasNoEXIF(t *testing.T) {
	src := withEXIFOrientation(t, testutil.JPEG(t, 600, 800, color.NRGBA{R: 10, G: 200, B: 30, A: 255}), 1)
	if !bytes.Contains(src, []byte("Exif")) {
		t.Fatal("fixture has no EXIF")
	}
	img, err := Normalize(src)
	if err != nil {
		t.Fatal(err)
	}
	out, err := JPEGBytes(img, FinalQuality)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(out, []byte("Exif")) || bytes.Contains(out, []byte("GPS-LATITUDE")) || bytes.Contains(out, []byte{0xFF, 0xE1}) {
		t.Fatal("output still carries EXIF/APP1")
	}
	thumb, err := Thumbnail(img)
	if err != nil {
		t.Fatal(err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(thumb))
	if err != nil || max(cfg.Width, cfg.Height) != ThumbSide {
		t.Fatalf("thumbnail %dx%d (%v), want long side %d", cfg.Width, cfg.Height, err, ThumbSide)
	}
}

func FuzzValidate(f *testing.F) {
	f.Add([]byte{0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x4E, 0x20, 0x4E, 0x20})
	f.Add([]byte("not an image"))
	f.Fuzz(func(t *testing.T, data []byte) {
		cfg, err := Validate(data)
		if err != nil {
			return
		}
		if cfg.Width < MinSide || cfg.Height < MinSide || cfg.Width > MaxSide || cfg.Height > MaxSide || cfg.Width*cfg.Height > MaxPixels {
			t.Fatalf("accepted %dx%d", cfg.Width, cfg.Height)
		}
	})
}
