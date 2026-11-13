package auth

import (
	"bytes"
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nethstore/estudio/api/internal/testutil"
)

const ip = "192.168.1.20"

type fixture struct {
	svc    *Service
	clock  *testutil.Clock
	secret string
	logs   *bytes.Buffer
}

func newFixture(t *testing.T, global bool) *fixture {
	t.Helper()
	db := testutil.DB(t)
	logs := &bytes.Buffer{}
	svc := NewService(db, 720*time.Hour, global, testutil.Logger(logs))
	clock := testutil.NewClock()
	svc.Now = clock.Now
	secret, err := svc.Rotate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{svc: svc, clock: clock, secret: secret, logs: logs}
}

func wrong(secret string) string {
	if secret[0] == 'a' {
		return "b" + secret[1:]
	}
	return "a" + secret[1:]
}

func TestLoginSuccessAndAuthenticate(t *testing.T) {
	f := newFixture(t, true)
	ctx := context.Background()
	res, err := f.svc.Login(ctx, ip, "Chrome", f.secret)
	if err != nil {
		t.Fatal(err)
	}
	if !res.ExpiresAt.Equal(f.clock.Now().Add(720 * time.Hour)) {
		t.Fatalf("expires %v", res.ExpiresAt)
	}
	if _, err := f.svc.Authenticate(ctx, res.Token); err != nil {
		t.Fatal(err)
	}
	// A new login gives a new token (no fixation).
	res2, _ := f.svc.Login(ctx, ip, "Chrome", f.secret)
	if res2.Token == res.Token {
		t.Fatal("token reused")
	}
	// Absolute expiry.
	f.clock.Advance(720*time.Hour + time.Second)
	if _, err := f.svc.Authenticate(ctx, res.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expired session accepted: %v", err)
	}
	if _, err := f.svc.Authenticate(ctx, ""); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("empty token accepted")
	}
	if _, err := f.svc.Authenticate(ctx, strings.Repeat("a", 200)); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("long token accepted")
	}
}

func TestLastSeenTouchedAtMostOncePerMinute(t *testing.T) {
	f := newFixture(t, false)
	ctx := context.Background()
	res, _ := f.svc.Login(ctx, ip, "", f.secret)
	f.clock.Advance(30 * time.Second)
	s, _ := f.svc.Authenticate(ctx, res.Token)
	if !s.LastSeenAt.Equal(f.clock.Now().Add(-30 * time.Second)) {
		t.Fatalf("touched too early: %v", s.LastSeenAt)
	}
	f.clock.Advance(31 * time.Second)
	_, _ = f.svc.Authenticate(ctx, res.Token)
	s, _ = f.svc.Authenticate(ctx, res.Token)
	if !s.LastSeenAt.Equal(f.clock.Now()) {
		t.Fatalf("not touched after a minute: %v", s.LastSeenAt)
	}
}

func TestLoginErrors(t *testing.T) {
	f := newFixture(t, true)
	ctx := context.Background()
	if _, err := f.svc.Login(ctx, ip, "", "short"); !errors.Is(err, ErrInvalidFormat) {
		t.Fatalf("err = %v", err)
	}
	_, err := f.svc.Login(ctx, ip, "", wrong(f.secret))
	var inv *InvalidSecretError
	if !errors.As(err, &inv) || inv.Remaining != 4 {
		t.Fatalf("err = %v", err)
	}
}

// SPEC 12.8 item 5: sixth attempt in the same minute is refused.
func TestPerMinuteLimit(t *testing.T) {
	f := newFixture(t, true)
	ctx := context.Background()
	for i := range 5 {
		_, err := f.svc.Login(ctx, ip, "", wrong(f.secret))
		var inv *InvalidSecretError
		if !errors.As(err, &inv) || inv.Remaining != 4-i {
			t.Fatalf("attempt %d: err = %v", i+1, err)
		}
		f.clock.Advance(time.Second)
	}
	_, err := f.svc.Login(ctx, ip, "", f.secret)
	var tm *TooManyAttemptsError
	if !errors.As(err, &tm) {
		t.Fatalf("6th attempt: err = %v", err)
	}
	if tm.RetryAfter <= 0 || tm.RetryAfter > time.Minute {
		t.Fatalf("retry after %v", tm.RetryAfter)
	}
	// Another IP is not affected.
	if _, err := f.svc.Login(ctx, "192.168.1.21", "", f.secret); err != nil {
		t.Fatalf("other ip blocked: %v", err)
	}
	f.clock.Advance(tm.RetryAfter)
	if _, err := f.svc.Login(ctx, ip, "", f.secret); err != nil {
		t.Fatalf("after waiting: %v", err)
	}
}

// SPEC 12.8 item 6: 10 failures in 15 minutes lock the IP for 15 minutes,
// even for the right secret.
func TestFailureLockout(t *testing.T) {
	f := newFixture(t, true)
	ctx := context.Background()
	for i := range 10 {
		_, err := f.svc.Login(ctx, ip, "", wrong(f.secret))
		var inv *InvalidSecretError
		if !errors.As(err, &inv) {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
		f.clock.Advance(61 * time.Second) // stay under the per-minute limit
	}
	_, err := f.svc.Login(ctx, ip, "", f.secret)
	var tm *TooManyAttemptsError
	if !errors.As(err, &tm) {
		t.Fatalf("right secret after lockout: %v", err)
	}
	if tm.RetryAfter < 13*time.Minute || tm.RetryAfter > 15*time.Minute {
		t.Fatalf("retry after %v", tm.RetryAfter)
	}
	f.clock.Advance(tm.RetryAfter - time.Second)
	if _, err := f.svc.Login(ctx, ip, "", f.secret); !errors.As(err, &tm) {
		t.Fatalf("lock ended early: %v", err)
	}
	f.clock.Advance(2 * time.Second)
	if _, err := f.svc.Login(ctx, ip, "", f.secret); err != nil {
		t.Fatalf("after lock: %v", err)
	}
}

func TestGlobalLockout(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		f := newFixture(t, enabled)
		ctx := context.Background()
		for i := range 31 {
			// A different IP each time escapes the per-IP limits.
			_, _ = f.svc.Login(ctx, "10.0.0."+strconv.Itoa(i+1), "", wrong(f.secret))
			f.clock.Advance(time.Minute)
		}
		_, err := f.svc.Login(ctx, "10.0.1.1", "", f.secret)
		var tm *TooManyAttemptsError
		if enabled {
			if !errors.As(err, &tm) {
				t.Fatalf("global lock not applied: %v", err)
			}
			if !strings.Contains(f.logs.String(), "global") {
				t.Fatal("no warning logged")
			}
		} else if err != nil {
			t.Fatalf("global lock applied while disabled: %v", err)
		}
	}
}

// SPEC 12.8 item 16.
func TestRotateRevokesSessions(t *testing.T) {
	f := newFixture(t, true)
	ctx := context.Background()
	res, _ := f.svc.Login(ctx, ip, "", f.secret)
	newSecret, err := f.svc.Rotate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Authenticate(ctx, res.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("session survived rotation")
	}
	if _, err := f.svc.Login(ctx, ip, "", f.secret); err == nil {
		t.Fatal("old secret still works")
	}
	if _, err := f.svc.Login(ctx, ip, "", newSecret); err != nil {
		t.Fatal(err)
	}
}

func TestLogout(t *testing.T) {
	f := newFixture(t, true)
	ctx := context.Background()
	res, _ := f.svc.Login(ctx, ip, "", f.secret)
	if err := f.svc.Logout(ctx, res.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Authenticate(ctx, res.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("session survived logout")
	}
	if err := f.svc.Logout(ctx, ""); err != nil {
		t.Fatal(err)
	}
}

func TestNoSecretConfigured(t *testing.T) {
	db := testutil.DB(t)
	svc := NewService(db, time.Hour, true, testutil.Logger(nil))
	if _, err := svc.Login(context.Background(), ip, "", "k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E"); !errors.Is(err, ErrNoSecret) {
		t.Fatalf("err = %v", err)
	}
}

func TestErrorStrings(t *testing.T) {
	if (&InvalidSecretError{Remaining: 2}).Error() == "" || (&TooManyAttemptsError{RetryAfter: time.Second}).Error() == "" {
		t.Fatal("empty error string")
	}
}
