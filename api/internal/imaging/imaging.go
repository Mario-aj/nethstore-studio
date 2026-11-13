// Package imaging validates uploaded photos, normalizes them and encodes
// JPEG outputs. Every limit is checked on the header before decoding.
package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"

	"github.com/disintegration/imaging"
)

// Limits from SPEC 9.1.
const (
	MinSide      = 200
	MaxSide      = 8000
	MaxPixels    = 40_000_000
	NormalSide   = 1600
	ThumbSide    = 480
	ThumbQuality = 80
	FinalQuality = 90
)

// ErrInvalidImage is a permanent failure: not a JPEG or outside the limits.
var ErrInvalidImage = errors.New("invalid image")

// Validate reads only the header and checks format and dimensions.
func Validate(data []byte) (image.Config, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return cfg, fmt.Errorf("%w: %w", ErrInvalidImage, err)
	}
	if format != "jpeg" {
		return cfg, fmt.Errorf("%w: format %q", ErrInvalidImage, format)
	}
	if cfg.Width < MinSide || cfg.Height < MinSide || cfg.Width > MaxSide || cfg.Height > MaxSide {
		return cfg, fmt.Errorf("%w: %dx%d outside %d..%d", ErrInvalidImage, cfg.Width, cfg.Height, MinSide, MaxSide)
	}
	if int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return cfg, fmt.Errorf("%w: %dx%d above %d pixels", ErrInvalidImage, cfg.Width, cfg.Height, MaxPixels)
	}
	return cfg, nil
}

// Normalize validates, decodes honoring EXIF orientation and shrinks the
// longest side to NormalSide (never enlarges).
func Normalize(data []byte) (*image.NRGBA, error) {
	if _, err := Validate(data); err != nil {
		return nil, err
	}
	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("%w: decode: %w", ErrInvalidImage, err)
	}
	return Fit(img, NormalSide), nil
}

// Fit shrinks img so its longest side is at most side (Lanczos).
func Fit(img image.Image, side int) *image.NRGBA {
	b := img.Bounds()
	if b.Dx() <= side && b.Dy() <= side {
		return imaging.Clone(img)
	}
	if b.Dx() >= b.Dy() {
		return imaging.Resize(img, side, 0, imaging.Lanczos)
	}
	return imaging.Resize(img, 0, side, imaging.Lanczos)
}

// EncodeJPEG writes img as baseline JPEG without metadata.
func EncodeJPEG(w io.Writer, img image.Image, quality int) error {
	return jpeg.Encode(w, img, &jpeg.Options{Quality: quality})
}

// JPEGBytes encodes img and returns the bytes.
func JPEGBytes(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := EncodeJPEG(&buf, img, quality); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Thumbnail returns the JPEG thumbnail bytes of img.
func Thumbnail(img image.Image) ([]byte, error) {
	return JPEGBytes(Fit(img, ThumbSide), ThumbQuality)
}
