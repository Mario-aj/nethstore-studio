package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

// signingKey is the SigV4 key derivation, written independently of the SDK.
func signingKey(secret, date, region, service string) []byte {
	k := hmacSHA256([]byte("AWS4"+secret), date)
	k = hmacSHA256(k, region)
	k = hmacSHA256(k, service)
	return hmacSHA256(k, "aws4_request")
}

// AWS documentation example for deriving a SigV4 signing key.
func TestSigningKeyAWSExample(t *testing.T) {
	got := hex.EncodeToString(signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam"))
	if got != "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d" {
		t.Fatalf("derived key %s", got)
	}
}

func TestPresignUpload(t *testing.T) {
	s := New(Config{
		Endpoint: "http://garage:3900", Region: "garage", Bucket: "estudio",
		AccessKeyID: "GK0123456789abcdef01234567", SecretAccessKey: "secret-for-tests",
		UploadPath: "/s3/estudio", MaxUploadBytes: 15 << 20,
	})
	now := time.Now().UTC()
	key := "originals/b/p.jpg"
	up, err := s.PresignUpload(context.Background(), key, now)
	if err != nil {
		t.Fatal(err)
	}
	if up.URL != "/s3/estudio" || !up.ExpiresAt.After(now.Add(14*time.Minute)) || up.ExpiresAt.After(now.Add(16*time.Minute)) {
		t.Fatalf("upload %+v", up)
	}
	for _, f := range []string{"key", "Content-Type", "x-amz-algorithm", "x-amz-credential", "x-amz-date", "policy", "x-amz-signature"} {
		if up.Fields[f] == "" {
			t.Errorf("missing field %s in %v", f, up.Fields)
		}
	}
	if len(up.Fields) != 7 {
		t.Errorf("unexpected fields %v", up.Fields)
	}
	if up.Fields["key"] != key || up.Fields["Content-Type"] != "image/jpeg" || up.Fields["x-amz-algorithm"] != "AWS4-HMAC-SHA256" {
		t.Fatalf("fields %v", up.Fields)
	}
	cred := up.Fields["x-amz-credential"]
	date := up.Fields["x-amz-date"][:8]
	if cred != "GK0123456789abcdef01234567/"+date+"/garage/s3/aws4_request" {
		t.Fatalf("credential %s", cred)
	}

	raw, err := base64.StdEncoding.DecodeString(up.Fields["policy"])
	if err != nil {
		t.Fatal(err)
	}
	var policy struct {
		Expiration string `json:"expiration"`
		Conditions []any  `json:"conditions"`
	}
	if err := json.Unmarshal(raw, &policy); err != nil {
		t.Fatal(err)
	}
	doc := string(raw)
	for _, want := range []string{`{"bucket":"estudio"}`, `{"key":"` + key + `"}`, `{"Content-Type":"image/jpeg"}`,
		`["content-length-range",1024,15728640]`, `"AWS4-HMAC-SHA256"`, cred, up.Fields["x-amz-date"]} {
		if !strings.Contains(doc, want) {
			t.Errorf("policy lacks %s: %s", want, doc)
		}
	}
	exp, err := time.Parse(time.RFC3339, policy.Expiration)
	if err != nil || exp.Sub(now) > 16*time.Minute || exp.Sub(now) < 14*time.Minute {
		t.Fatalf("expiration %s", policy.Expiration)
	}
	// Signature = HMAC(signing key, base64 policy).
	want := hex.EncodeToString(hmacSHA256(signingKey("secret-for-tests", date, "garage", "s3"), up.Fields["policy"]))
	if up.Fields["x-amz-signature"] != want {
		t.Fatalf("signature %s, want %s", up.Fields["x-amz-signature"], want)
	}
	if s.Bucket() != "estudio" {
		t.Fatal("bucket")
	}
}

func TestMapErr(t *testing.T) {
	if mapErr(nil) != nil {
		t.Fatal("nil")
	}
	if !errors.Is(mapErr(&types.NoSuchKey{}), ErrNotFound) || !errors.Is(mapErr(&types.NotFound{}), ErrNotFound) {
		t.Fatal("not found not mapped")
	}
	other := fmt.Errorf("boom")
	if !errors.Is(mapErr(other), other) {
		t.Fatal("other error changed")
	}
}

func TestDeletePrefixGuards(t *testing.T) {
	s := New(Config{Endpoint: "http://127.0.0.1:1", Region: "garage", Bucket: "estudio"})
	for _, p := range []string{"", "originals"} {
		if err := s.DeletePrefix(context.Background(), p); err == nil {
			t.Errorf("prefix %q accepted", p)
		}
	}
}
