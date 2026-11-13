// Package auth implements the access secret, sessions and the login rate
// limiter (SPEC 12.2 to 12.4).
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
)

// SecretLen is the length of the access secret.
const SecretLen = 32

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// Argon2id parameters (SPEC 12.2).
const (
	argonMemoryKiB = 64 * 1024
	argonTime      = 1
	argonThreads   = 4
	argonKeyLen    = 32
	argonSaltLen   = 16
)

// GenerateSecret returns 32 base62 characters from crypto/rand, using
// rejection sampling so every character is equally likely.
func GenerateSecret() (string, error) { return generateSecret(rand.Reader) }

func generateSecret(r io.Reader) (string, error) {
	out := make([]byte, 0, SecretLen)
	buf := make([]byte, 64)
	// 248 is the largest multiple of 62 below 256: bytes >= 248 are discarded.
	const limit = 256 - 256%len(base62)
	for len(out) < SecretLen {
		if _, err := io.ReadFull(r, buf); err != nil {
			return "", fmt.Errorf("read random: %w", err)
		}
		for _, b := range buf {
			if int(b) >= limit {
				continue
			}
			out = append(out, base62[int(b)%len(base62)])
			if len(out) == SecretLen {
				break
			}
		}
	}
	return string(out), nil
}

// ValidFormat reports whether s has exactly 32 base62 characters.
func ValidFormat(s string) bool {
	if len(s) != SecretLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		if strings.IndexByte(base62, s[i]) < 0 {
			return false
		}
	}
	return true
}

// HashSecret returns the argon2id hash of secret in PHC format.
func HashSecret(secret string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(secret), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

// ErrBadHash is returned for a malformed PHC string.
var ErrBadHash = errors.New("malformed argon2id hash")

// VerifySecret checks secret against a PHC hash in constant time.
func VerifySecret(secret, phc string) (bool, error) {
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, ErrBadHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrBadHash
	}
	var m uint32
	var t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || m == 0 || t == 0 || p == 0 || m > 1<<21 {
		return false, ErrBadHash
	}
	enc := base64.RawStdEncoding
	salt, err := enc.DecodeString(parts[4])
	if err != nil {
		return false, ErrBadHash
	}
	want, err := enc.DecodeString(parts[5])
	if err != nil || len(want) == 0 || len(want) > 64 {
		return false, ErrBadHash
	}
	got := argon2.IDKey([]byte(secret), salt, t, m, p, uint32(len(want))) //nolint:gosec // G115: len(want) <= 64
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// NewToken returns a random session token (base64url, 32 bytes) and its
// SHA-256, which is the only thing stored.
func NewToken() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token), nil
}

// HashToken returns the SHA-256 of a session token.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
