package stamp

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"

	"github.com/nethstore/estudio/api/assets/fonts"
)

// Layout holds every number of the stamp drawing, so it can be tuned after
// testing on real photos (SPEC 9.3).
type Layout struct {
	// FontSizeRatio is the font size as a fraction of the image width.
	FontSizeRatio float64
	// MarginLeftRatio is the left margin as a fraction of the image width.
	MarginLeftRatio float64
	// TopRatio is the top of the first line as a fraction of the image height.
	TopRatio float64
	// LineHeight is the distance between baselines, in multiples of the font size.
	LineHeight float64
	// MaxLineWidthRatio is the widest a line may be, as a fraction of the width.
	MaxLineWidthRatio float64
	// Dark is the default text color, Light the one used on dark backgrounds.
	Dark  color.NRGBA
	Light color.NRGBA
	// LumaThreshold: when the mean luma (Rec. 709 weights over gamma-encoded
	// sRGB, 0..1) of the text area is below it, Light is used.
	LumaThreshold float64
}

// DefaultLayout returns the values from SPEC 9.3.
func DefaultLayout() Layout {
	return Layout{
		FontSizeRatio:     0.034,
		MarginLeftRatio:   0.03,
		TopRatio:          0.07,
		LineHeight:        1.25,
		MaxLineWidthRatio: 0.90,
		Dark:              color.NRGBA{R: 0x11, G: 0x11, B: 0x11, A: 0xff},
		Light:             color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff},
		LumaThreshold:     0.45,
	}
}

var (
	fontOnce sync.Once
	fontVal  *opentype.Font
	fontErr  error
)

func stampFont() (*opentype.Font, error) {
	fontOnce.Do(func() { fontVal, fontErr = opentype.Parse(fonts.WorkSansMedium) })
	return fontVal, fontErr
}

// Result describes what Draw did (used by tests and logs).
type Result struct {
	FontSize float64
	Light    bool
}

// Draw writes the two stamp lines on img in place.
func Draw(img draw.Image, line1, line2 string, l Layout) (Result, error) {
	f, err := stampFont()
	if err != nil {
		return Result{}, fmt.Errorf("parse font: %w", err)
	}
	b := img.Bounds()
	w, h := float64(b.Dx()), float64(b.Dy())
	size := math.Max(1, l.FontSizeRatio*w)
	maxWidth := l.MaxLineWidthRatio * w

	face, err := newFace(f, size)
	if err != nil {
		return Result{}, err
	}
	// Shrink both lines together until the widest one fits.
	for range 8 {
		widest := math.Max(measure(face, line1), measure(face, line2))
		if widest <= maxWidth || size <= 1 {
			break
		}
		_ = face.Close()
		size = math.Max(1, size*maxWidth/widest*0.98)
		if face, err = newFace(f, size); err != nil {
			return Result{}, err
		}
	}
	defer func() { _ = face.Close() }()

	metrics := face.Metrics()
	ascent := float64(metrics.Ascent) / 64
	descent := float64(metrics.Descent) / 64
	x := float64(b.Min.X) + l.MarginLeftRatio*w
	top := float64(b.Min.Y) + l.TopRatio*h
	baseline1 := top + ascent
	baseline2 := baseline1 + l.LineHeight*size

	textWidth := math.Max(measure(face, line1), measure(face, line2))
	area := image.Rect(int(x), int(top), int(math.Ceil(x+textWidth)), int(math.Ceil(baseline2+descent))).Intersect(b)
	light := meanLuma(img, area) < l.LumaThreshold
	col := l.Dark
	if light {
		col = l.Light
	}

	d := &font.Drawer{Dst: img, Src: image.NewUniform(col), Face: face}
	d.Dot = fixed.Point26_6{X: toFixed(x), Y: toFixed(baseline1)}
	d.DrawString(line1)
	d.Dot = fixed.Point26_6{X: toFixed(x), Y: toFixed(baseline2)}
	d.DrawString(line2)
	return Result{FontSize: size, Light: light}, nil
}

func newFace(f *opentype.Font, size float64) (font.Face, error) {
	face, err := opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
	if err != nil {
		return nil, fmt.Errorf("new face: %w", err)
	}
	return face, nil
}

func measure(face font.Face, s string) float64 {
	return float64(font.MeasureString(face, s)) / 64
}

func toFixed(v float64) fixed.Int26_6 { return fixed.Int26_6(math.Round(v * 64)) }

// meanLuma returns the average luma (0..1) of r, sampling at most ~10k pixels.
func meanLuma(img image.Image, r image.Rectangle) float64 {
	if r.Empty() {
		return 1
	}
	step := int(math.Max(1, math.Sqrt(float64(r.Dx()*r.Dy())/10000)))
	var sum float64
	var n int
	for y := r.Min.Y; y < r.Max.Y; y += step {
		for x := r.Min.X; x < r.Max.X; x += step {
			c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			sum += 0.2126*float64(c.R)/255 + 0.7152*float64(c.G)/255 + 0.0722*float64(c.B)/255
			n++
		}
	}
	if n == 0 {
		return 1
	}
	return sum / float64(n)
}
