package auth

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestGenerateSecret(t *testing.T) {
	seen := map[string]bool{}
	counts := map[byte]int{}
	for range 300 {
		s, err := GenerateSecret()
		if err != nil {
			t.Fatal(err)
		}
		if !ValidFormat(s) {
			t.Fatalf("invalid secret %q", s)
		}
		if seen[s] {
			t.Fatal("repeated secret")
		}
		seen[s] = true
		for i := 0; i < len(s); i++ {
			counts[s[i]]++
		}
	}
	// 9600 characters over 62 symbols: every symbol should show up.
	if len(counts) != 62 {
		t.Fatalf("only %d distinct symbols", len(counts))
	}
}

func TestGenerateSecretRejectionSampling(t *testing.T) {
	// Bytes >= 248 must be skipped: feed only 255s then valid bytes.
	src := bytes.NewReader(append(bytes.Repeat([]byte{255}, 64), bytes.Repeat([]byte{61}, 64)...))
	s, err := generateSecret(src)
	if err != nil {
		t.Fatal(err)
	}
	if s != strings.Repeat("z", 32) {
		t.Fatalf("got %q", s)
	}
	if _, err := generateSecret(bytes.NewReader(nil)); err == nil {
		t.Fatal("expected read error")
	}
}

func TestValidFormat(t *testing.T) {
	good := "k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E"
	if !ValidFormat(good) {
		t.Fatal("rejected valid secret")
	}
	for _, s := range []string{"", good[:31], good + "a", "k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5-", "k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5é"} {
		if ValidFormat(s) {
			t.Errorf("accepted %q", s)
		}
	}
}

func TestHashAndVerify(t *testing.T) {
	secret := "k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E"
	h, err := HashSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=65536,t=1,p=4$") || strings.Contains(h, secret) {
		t.Fatalf("unexpected hash %q", h)
	}
	if ok, err := VerifySecret(secret, h); !ok || err != nil {
		t.Fatalf("verify = %v, %v", ok, err)
	}
	if ok, _ := VerifySecret("x7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E", h); ok {
		t.Fatal("wrong secret accepted")
	}
	h2, _ := HashSecret(secret)
	if h == h2 {
		t.Fatal("salt not random")
	}
	for _, bad := range []string{"", "$argon2i$v=19$m=65536,t=1,p=4$AAAA$AAAA", "$argon2id$v=18$m=65536,t=1,p=4$AAAA$AAAA",
		"$argon2id$v=19$m=x,t=1,p=4$AAAA$AAAA", "$argon2id$v=19$m=65536,t=1,p=4$!!$AAAA", "$argon2id$v=19$m=65536,t=1,p=4$AAAA$"} {
		if _, err := VerifySecret(secret, bad); !errors.Is(err, ErrBadHash) {
			t.Errorf("%q: err = %v", bad, err)
		}
	}
}

func TestTokens(t *testing.T) {
	tok, h, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) != 43 || !bytes.Equal(h, HashToken(tok)) || len(h) != 32 {
		t.Fatalf("token %q hash %x", tok, h)
	}
	tok2, _, _ := NewToken()
	if tok == tok2 {
		t.Fatal("repeated token")
	}
}
