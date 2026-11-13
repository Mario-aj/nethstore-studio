// Package stamp builds the stamp text (shared rules with the web app, see
// testdata/stamp-text.json) and draws it on images.
package stamp

import (
	"errors"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Sizes in canonical order.
var Sizes = []string{"XS", "S", "M", "L", "XL", "2XL"}

// Limits shared with the web app.
const (
	MaxDescriptionLen = 24
	MinPriceKz        = 1
	MaxPriceKz        = 9_999_999
)

// Validation errors.
var (
	ErrSizes       = errors.New("sizes must be 1 to 6 distinct values among XS, S, M, L, XL, 2XL")
	ErrDescription = errors.New("description must have up to 24 letters, digits, spaces or . , ' ( ) & +")
	ErrPrice       = errors.New("price must be between 1 and 9999999")
)

// NormalizeSizes validates sizes and returns them in canonical order.
func NormalizeSizes(in []string) ([]string, error) {
	if len(in) == 0 || len(in) > len(Sizes) {
		return nil, ErrSizes
	}
	seen := make(map[string]bool, len(in))
	for _, s := range in {
		if seen[s] || !isSize(s) {
			return nil, ErrSizes
		}
		seen[s] = true
	}
	out := make([]string, 0, len(in))
	for _, s := range Sizes {
		if seen[s] {
			out = append(out, s)
		}
	}
	return out, nil
}

func isSize(s string) bool {
	for _, v := range Sizes {
		if v == s {
			return true
		}
	}
	return false
}

// NormalizeDescription applies NFC, trims, collapses inner whitespace and
// validates the allowed characters. Empty input returns "" (absent).
func NormalizeDescription(s string) (string, error) {
	if !utf8.ValidString(s) {
		return "", ErrDescription
	}
	for _, r := range s {
		if unicode.IsControl(r) && r != ' ' {
			// Tabs and newlines are control characters too: rejected, not collapsed.
			return "", ErrDescription
		}
	}
	s = norm.NFC.String(s)
	s = strings.Join(strings.FieldsFunc(s, unicode.IsSpace), " ")
	if s == "" {
		return "", nil
	}
	if utf8.RuneCountInString(s) > MaxDescriptionLen {
		return "", ErrDescription
	}
	for _, r := range s {
		if !allowedDescriptionRune(r) {
			return "", ErrDescription
		}
	}
	return s, nil
}

func allowedDescriptionRune(r rune) bool {
	if unicode.IsLetter(r) || unicode.IsNumber(r) {
		return true
	}
	switch r {
	case ' ', '.', ',', '\'', '(', ')', '&', '+':
		return true
	}
	return false
}

// ValidatePrice checks the price range.
func ValidatePrice(kz int64) error {
	if kz < MinPriceKz || kz > MaxPriceKz {
		return ErrPrice
	}
	return nil
}

// JoinSizes renders sizes (already canonical) as "M", "M e L" or "S, M e L".
func JoinSizes(sizes []string) string {
	switch len(sizes) {
	case 0:
		return ""
	case 1:
		return sizes[0]
	}
	return strings.Join(sizes[:len(sizes)-1], ", ") + " e " + sizes[len(sizes)-1]
}

// FormatPrice renders 10000 as "10.000 kz".
func FormatPrice(kz int64) string {
	digits := strconv.FormatInt(kz, 10)
	neg := strings.HasPrefix(digits, "-")
	digits = strings.TrimPrefix(digits, "-")
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	out := b.String()
	if neg {
		out = "-" + out
	}
	return out + " kz"
}

// Lines builds both stamp lines. sizes may be in any order; description is
// normalized. Invalid input returns an error.
func Lines(priceKz int64, sizes []string, description string) (line1, line2 string, err error) {
	if err := ValidatePrice(priceKz); err != nil {
		return "", "", err
	}
	canon, err := NormalizeSizes(sizes)
	if err != nil {
		return "", "", err
	}
	desc, err := NormalizeDescription(description)
	if err != nil {
		return "", "", err
	}
	line1 = JoinSizes(canon)
	if desc != "" {
		line1 = desc + "/ " + line1
	}
	return line1, FormatPrice(priceKz), nil
}
