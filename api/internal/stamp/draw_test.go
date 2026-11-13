package stamp

import (
	"flag"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "regenerate golden images in testdata/golden")

func background(w, h int, base color.NRGBA) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// Soft diagonal gradient, like a studio backdrop.
			f := 0.9 + 0.1*float64(x+y)/float64(w+h)
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(float64(base.R) * f), G: uint8(float64(base.G) * f), B: uint8(float64(base.B) * f), A: 255})
		}
	}
	return img
}

func TestDrawGolden(t *testing.T) {
	light := color.NRGBA{R: 236, G: 230, B: 220, A: 255}
	dark := color.NRGBA{R: 40, G: 36, B: 33, A: 255}
	cases := []struct {
		name      string
		w, h      int
		bg        color.NRGBA
		wantLight bool
	}{
		{"light-1200x1600", 1200, 1600, light, false},
		{"dark-1200x1600", 1200, 1600, dark, true},
		{"light-1600x1200", 1600, 1200, light, false},
		{"dark-1600x1200", 1600, 1200, dark, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			img := background(c.w, c.h, c.bg)
			res, err := Draw(img, "Veste/ M e L", "10.000 kz", DefaultLayout())
			if err != nil {
				t.Fatal(err)
			}
			if res.Light != c.wantLight {
				t.Fatalf("light text = %v, want %v", res.Light, c.wantLight)
			}
			if want := 0.034 * float64(c.w); math.Abs(res.FontSize-want) > 0.01 {
				t.Fatalf("font size %.2f, want %.2f", res.FontSize, want)
			}
			path := filepath.Join("..", "..", "testdata", "golden", "stamp-"+c.name+".png")
			if *update {
				writePNG(t, path, img)
				return
			}
			compareGolden(t, path, img)
		})
	}
}

func TestDrawShrinksLongLine(t *testing.T) {
	// Longest possible line 1: 24-char description and all six sizes.
	const line1 = "Conjunto de festa longo/ XS, S, M, L, XL e 2XL"
	img := background(1600, 1200, color.NRGBA{R: 230, G: 230, B: 230, A: 255})
	// With the default ratio this line fits (about 77% of the width), so use a
	// larger font to force the reduction path.
	l := DefaultLayout()
	l.FontSizeRatio = 0.06
	res, err := Draw(img, line1, "1.250.000 kz", l)
	if err != nil {
		t.Fatal(err)
	}
	if res.FontSize >= 0.06*1600 {
		t.Fatalf("font not reduced: %.2f", res.FontSize)
	}
	f, _ := stampFont()
	face, _ := newFace(f, res.FontSize)
	defer func() { _ = face.Close() }()
	if w := measure(face, line1); w > 0.9*1600 {
		t.Fatalf("line still %.1f px wide", w)
	}
}

func TestDrawTextInTopLeft(t *testing.T) {
	img := background(1200, 1600, color.NRGBA{R: 240, G: 240, B: 240, A: 255})
	before := image.NewNRGBA(img.Bounds())
	copy(before.Pix, img.Pix)
	if _, err := Draw(img, "M", "2.500 kz", DefaultLayout()); err != nil {
		t.Fatal(err)
	}
	var changed image.Rectangle
	first := true
	for y := 0; y < 1600; y++ {
		for x := 0; x < 1200; x++ {
			i := img.PixOffset(x, y)
			if img.Pix[i] != before.Pix[i] {
				r := image.Rect(x, y, x+1, y+1)
				if first {
					changed, first = r, false
				} else {
					changed = changed.Union(r)
				}
			}
		}
	}
	if first {
		t.Fatal("nothing drawn")
	}
	if changed.Min.X < int(0.03*1200)-2 || changed.Min.Y < int(0.07*1600)-2 || changed.Max.X > 600 || changed.Max.Y > 400 {
		t.Fatalf("text drawn at %v, expected top-left corner", changed)
	}
}

func writePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

// compareGolden allows a small per-pixel difference (font rasterization
// may differ by one level between platforms).
func compareGolden(t *testing.T, path string, got *image.NRGBA) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("golden missing (run go test ./internal/stamp -update): %v", err)
	}
	defer func() { _ = f.Close() }()
	want, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if want.Bounds() != got.Bounds() {
		t.Fatalf("bounds %v, want %v", got.Bounds(), want.Bounds())
	}
	const tolerance = 8
	bad := 0
	b := got.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			g := got.NRGBAAt(x, y)
			w := color.NRGBAModel.Convert(want.At(x, y)).(color.NRGBA)
			if absDiff(g.R, w.R) > tolerance || absDiff(g.G, w.G) > tolerance || absDiff(g.B, w.B) > tolerance {
				bad++
			}
		}
	}
	if bad > 50 {
		t.Fatalf("%d pixels differ from %s by more than %d", bad, path, tolerance)
	}
}

func absDiff(a, b uint8) int {
	if a > b {
		return int(a - b)
	}
	return int(b - a)
}
