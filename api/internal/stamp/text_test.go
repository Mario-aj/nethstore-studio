package stamp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

type vector struct {
	PriceKz     int64    `json:"priceKz"`
	Sizes       []string `json:"sizes"`
	Description *string  `json:"description"`
	Line1       string   `json:"line1"`
	Line2       string   `json:"line2"`
}

// The same vectors run in the web app (web/src/shared/lib/stamp.test.ts).
func TestLinesSharedVectors(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "stamp-text.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vs []vector
	if err := json.Unmarshal(raw, &vs); err != nil {
		t.Fatal(err)
	}
	if len(vs) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range vs {
		desc := ""
		if v.Description != nil {
			desc = *v.Description
		}
		l1, l2, err := Lines(v.PriceKz, v.Sizes, desc)
		if err != nil {
			t.Fatalf("%+v: %v", v, err)
		}
		if l1 != v.Line1 || l2 != v.Line2 {
			t.Errorf("Lines(%d, %v, %q) = %q, %q; want %q, %q", v.PriceKz, v.Sizes, desc, l1, l2, v.Line1, v.Line2)
		}
	}
}

func TestFormatPrice(t *testing.T) {
	cases := map[int64]string{1: "1 kz", 999: "999 kz", 1000: "1.000 kz", 10000: "10.000 kz", 1250000: "1.250.000 kz", 9999999: "9.999.999 kz", -5000: "-5.000 kz"}
	for in, want := range cases {
		if got := FormatPrice(in); got != want {
			t.Errorf("FormatPrice(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestJoinSizes(t *testing.T) {
	cases := []struct {
		in   []string
		want string
	}{
		{nil, ""}, {[]string{"M"}, "M"}, {[]string{"M", "L"}, "M e L"}, {[]string{"S", "M", "L"}, "S, M e L"},
	}
	for _, c := range cases {
		if got := JoinSizes(c.in); got != c.want {
			t.Errorf("JoinSizes(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeSizes(t *testing.T) {
	got, err := NormalizeSizes([]string{"2XL", "M", "XS"})
	if err != nil || strings.Join(got, ",") != "XS,M,2XL" {
		t.Fatalf("got %v, %v", got, err)
	}
	bad := [][]string{nil, {}, {"M", "M"}, {"XXL"}, {"m"}, {"XS", "S", "M", "L", "XL", "2XL", "M"}}
	for _, b := range bad {
		if _, err := NormalizeSizes(b); err == nil {
			t.Errorf("NormalizeSizes(%v) accepted", b)
		}
	}
}

func TestNormalizeDescription(t *testing.T) {
	ok := map[string]string{
		"":                           "",
		"   ":                        "",
		"Veste":                      "Veste",
		"  Saia   longa ":            "Saia longa",
		"Calça (2) & top + saia":     "Calça (2) & top + saia",
		"O'Neil, 2.0":                "O'Neil, 2.0",
		"Calça":                     "Calça", // NFD to NFC
		"Saia longa":                 "Saia longa",
		strings.Repeat("a", 24):      strings.Repeat("a", 24),
		"Vestido de festa curto 24c": "",
	}
	for in, want := range ok {
		got, err := NormalizeDescription(in)
		if want == "" && utf8.RuneCountInString(strings.TrimSpace(in)) > 24 {
			if err == nil {
				t.Errorf("%q: expected length error", in)
			}
			continue
		}
		if err != nil || got != want {
			t.Errorf("NormalizeDescription(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	bad := []string{"Veste/Saia", "tab\there", "nova\nlinha", "emoji 👗", "<b>", "a;b", strings.Repeat("a", 25), "\xff"}
	for _, b := range bad {
		if _, err := NormalizeDescription(b); err == nil {
			t.Errorf("NormalizeDescription(%q) accepted", b)
		}
	}
}

func TestLinesErrors(t *testing.T) {
	if _, _, err := Lines(0, []string{"M"}, ""); err == nil {
		t.Error("price 0 accepted")
	}
	if _, _, err := Lines(10_000_000, []string{"M"}, ""); err == nil {
		t.Error("price too high accepted")
	}
	if _, _, err := Lines(100, nil, ""); err == nil {
		t.Error("empty sizes accepted")
	}
	if _, _, err := Lines(100, []string{"M"}, "a/b"); err == nil {
		t.Error("slash accepted")
	}
}

func FuzzNormalizeDescription(f *testing.F) {
	for _, s := range []string{"Veste", "  Saia   longa ", "a/b", "Calça", "\x00", "😀"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		out, err := NormalizeDescription(s)
		if err != nil {
			return
		}
		if utf8.RuneCountInString(out) > MaxDescriptionLen || strings.ContainsAny(out, "/\t\n\r") {
			t.Fatalf("invalid output %q from %q", out, s)
		}
		if out != strings.TrimSpace(out) || strings.Contains(out, "  ") {
			t.Fatalf("not normalized: %q", out)
		}
		again, err := NormalizeDescription(out)
		if err != nil || again != out {
			t.Fatalf("not idempotent: %q -> %q (%v)", out, again, err)
		}
	})
}
