package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nethstore/estudio/api/internal/store"
)

// Errors returned by Login and Authenticate.
var (
	ErrInvalidFormat   = errors.New("invalid secret format")
	ErrNoSecret        = errors.New("no access secret configured")
	ErrUnauthenticated = errors.New("unauthenticated")
)

// InvalidSecretError is returned for a wrong secret.
type InvalidSecretError struct{ Remaining int }

func (e *InvalidSecretError) Error() string {
	return fmt.Sprintf("invalid secret (%d remaining)", e.Remaining)
}

// TooManyAttemptsError is returned when the limiter refuses the attempt.
type TooManyAttemptsError struct{ RetryAfter time.Duration }

func (e *TooManyAttemptsError) Error() string {
	return fmt.Sprintf("too many attempts, retry after %s", e.RetryAfter)
}

// Service ties secrets, sessions and the limiter together.
type Service struct {
	DB      *store.DB
	Limiter *Limiter
	TTL     time.Duration
	Now     func() time.Time
	Log     *slog.Logger
	// verify limits concurrent argon2id runs (64 MiB each).
	verify chan struct{}
}

// NewService builds a Service.
func NewService(db *store.DB, ttl time.Duration, globalLockout bool, log *slog.Logger) *Service {
	return &Service{
		DB:      db,
		Limiter: &Limiter{Store: db, GlobalLockout: globalLockout},
		TTL:     ttl,
		Now:     time.Now,
		Log:     log,
		verify:  make(chan struct{}, 2),
	}
}

// LoginResult carries a new session token.
type LoginResult struct {
	Token     string
	ExpiresAt time.Time
}

// Login checks the secret and opens a session.
func (s *Service) Login(ctx context.Context, ip, userAgent, secret string) (LoginResult, error) {
	if !ValidFormat(secret) {
		return LoginResult{}, ErrInvalidFormat
	}
	now := s.Now().UTC()
	dec, err := s.Limiter.Check(ctx, ip, now)
	if err != nil {
		return LoginResult{}, err
	}
	if !dec.Allowed {
		if dec.Global {
			s.Log.WarnContext(ctx, "login refused by global lockout", "retry_after_s", int(dec.RetryAfter.Seconds()))
		}
		return LoginResult{}, &TooManyAttemptsError{RetryAfter: dec.RetryAfter}
	}

	hash, err := s.DB.SecretHash(ctx)
	if errors.Is(err, store.ErrNotFound) {
		return LoginResult{}, ErrNoSecret
	}
	if err != nil {
		return LoginResult{}, err
	}

	select {
	case s.verify <- struct{}{}:
	case <-ctx.Done():
		return LoginResult{}, ctx.Err()
	}
	ok, err := VerifySecret(secret, hash)
	<-s.verify
	if err != nil {
		return LoginResult{}, err
	}

	if err := s.Limiter.Record(ctx, ip, now, ok); err != nil {
		return LoginResult{}, err
	}
	if !ok {
		if s.Limiter.GlobalLockout {
			if n, err := s.Limiter.GlobalFailures(ctx, now); err == nil && n > GlobalFailLimit {
				s.Log.WarnContext(ctx, "global login failure limit exceeded, login locked", "failures_last_hour", n)
			}
		}
		remaining, err := s.Limiter.Remaining(ctx, ip, now)
		if err != nil {
			return LoginResult{}, err
		}
		return LoginResult{}, &InvalidSecretError{Remaining: remaining}
	}

	token, tokenHash, err := NewToken()
	if err != nil {
		return LoginResult{}, err
	}
	if len(userAgent) > 256 {
		userAgent = userAgent[:256]
	}
	expires := now.Add(s.TTL)
	if err := s.DB.CreateSession(ctx, store.Session{
		TokenHash: tokenHash, CreatedAt: now, ExpiresAt: expires, LastSeenAt: now, UserAgent: userAgent,
	}); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{Token: token, ExpiresAt: expires}, nil
}

// Authenticate returns the session for token, touching last_seen_at at most
// once a minute.
func (s *Service) Authenticate(ctx context.Context, token string) (store.Session, error) {
	if token == "" || len(token) > 128 {
		return store.Session{}, ErrUnauthenticated
	}
	h := HashToken(token)
	sess, err := s.DB.SessionByHash(ctx, h)
	if errors.Is(err, store.ErrNotFound) {
		return sess, ErrUnauthenticated
	}
	if err != nil {
		return sess, err
	}
	now := s.Now().UTC()
	if !now.Before(sess.ExpiresAt) {
		_ = s.DB.DeleteSession(ctx, h)
		return sess, ErrUnauthenticated
	}
	if now.Sub(sess.LastSeenAt) >= time.Minute {
		if err := s.DB.TouchSession(ctx, h, now); err != nil {
			s.Log.WarnContext(ctx, "touch session failed", "err", err)
		}
	}
	return sess, nil
}

// Logout deletes the session for token.
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.DB.DeleteSession(ctx, HashToken(token))
}

// Rotate generates a new secret, stores its hash and revokes every session.
// The plain secret is returned once and must never be logged.
func (s *Service) Rotate(ctx context.Context) (string, error) {
	secret, err := GenerateSecret()
	if err != nil {
		return "", err
	}
	hash, err := HashSecret(secret)
	if err != nil {
		return "", err
	}
	if err := s.DB.RotateSecret(ctx, hash, s.Now().UTC()); err != nil {
		return "", err
	}
	return secret, nil
}
