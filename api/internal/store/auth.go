package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Session is a row of the sessions table (never holds the raw token).
type Session struct {
	TokenHash  []byte
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastSeenAt time.Time
	UserAgent  string
}

// SecretHash returns the stored PHC hash of the access secret.
func (d *DB) SecretHash(ctx context.Context) (string, error) {
	var h string
	err := d.R.QueryRowContext(ctx, `SELECT hash FROM auth_secret WHERE id = 1`).Scan(&h)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return h, err
}

// RotateSecret stores a new secret hash and deletes every session, atomically.
func (d *DB) RotateSecret(ctx context.Context, hash string, now time.Time) error {
	tx, err := d.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO auth_secret (id, hash, created_at) VALUES (1, ?, ?)
		ON CONFLICT (id) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at`, hash, FormatTime(now)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions`); err != nil {
		return err
	}
	return tx.Commit()
}

// CreateSession inserts a session.
func (d *DB) CreateSession(ctx context.Context, s Session) error {
	_, err := d.W.ExecContext(ctx, `INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)`,
		s.TokenHash, FormatTime(s.CreatedAt), FormatTime(s.ExpiresAt), FormatTime(s.LastSeenAt), s.UserAgent)
	return err
}

// SessionByHash loads a session by token hash.
func (d *DB) SessionByHash(ctx context.Context, hash []byte) (Session, error) {
	var s Session
	var created, expires, seen string
	err := d.R.QueryRowContext(ctx, `SELECT token_hash, created_at, expires_at, last_seen_at, user_agent FROM sessions WHERE token_hash = ?`, hash).
		Scan(&s.TokenHash, &created, &expires, &seen, &s.UserAgent)
	if errors.Is(err, sql.ErrNoRows) {
		return s, ErrNotFound
	}
	if err != nil {
		return s, err
	}
	if s.CreatedAt, err = ParseTime(created); err != nil {
		return s, err
	}
	if s.ExpiresAt, err = ParseTime(expires); err != nil {
		return s, err
	}
	if s.LastSeenAt, err = ParseTime(seen); err != nil {
		return s, err
	}
	return s, nil
}

// TouchSession updates last_seen_at.
func (d *DB) TouchSession(ctx context.Context, hash []byte, now time.Time) error {
	_, err := d.W.ExecContext(ctx, `UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`, FormatTime(now), hash)
	return err
}

// DeleteSession removes one session.
func (d *DB) DeleteSession(ctx context.Context, hash []byte) error {
	_, err := d.W.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hash)
	return err
}

// DeleteAllSessions removes every session and returns how many were removed.
func (d *DB) DeleteAllSessions(ctx context.Context) (int64, error) {
	res, err := d.W.ExecContext(ctx, `DELETE FROM sessions`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ListSessions returns all sessions, newest first.
func (d *DB) ListSessions(ctx context.Context) ([]Session, error) {
	rows, err := d.R.QueryContext(ctx, `SELECT token_hash, created_at, expires_at, last_seen_at, user_agent FROM sessions ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Session
	for rows.Next() {
		var s Session
		var created, expires, seen string
		if err := rows.Scan(&s.TokenHash, &created, &expires, &seen, &s.UserAgent); err != nil {
			return nil, err
		}
		s.CreatedAt, _ = ParseTime(created)
		s.ExpiresAt, _ = ParseTime(expires)
		s.LastSeenAt, _ = ParseTime(seen)
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteExpiredSessions removes sessions past expiry.
func (d *DB) DeleteExpiredSessions(ctx context.Context, now time.Time) (int64, error) {
	res, err := d.W.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, FormatTime(now))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// RecordLoginAttempt stores one attempt (never the secret).
func (d *DB) RecordLoginAttempt(ctx context.Context, ip string, at time.Time, success bool) error {
	s := 0
	if success {
		s = 1
	}
	_, err := d.W.ExecContext(ctx, `INSERT INTO login_attempts (ip, at, success) VALUES (?, ?, ?)`, ip, FormatTime(at), s)
	return err
}

// AttemptTimes returns attempt times for ip since t, oldest first. If
// failuresOnly, only failed attempts are returned.
func (d *DB) AttemptTimes(ctx context.Context, ip string, since time.Time, failuresOnly bool) ([]time.Time, error) {
	q := `SELECT at FROM login_attempts WHERE ip = ? AND at > ?`
	if failuresOnly {
		q += ` AND success = 0`
	}
	q += ` ORDER BY at`
	return d.queryTimes(ctx, q, ip, FormatTime(since))
}

// GlobalFailureTimes returns all failed attempt times since t, oldest first.
func (d *DB) GlobalFailureTimes(ctx context.Context, since time.Time) ([]time.Time, error) {
	return d.queryTimes(ctx, `SELECT at FROM login_attempts WHERE success = 0 AND at > ? ORDER BY at`, FormatTime(since))
}

func (d *DB) queryTimes(ctx context.Context, q string, args ...any) ([]time.Time, error) {
	rows, err := d.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []time.Time
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		t, err := ParseTime(s)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteLoginAttemptsBefore prunes old attempts.
func (d *DB) DeleteLoginAttemptsBefore(ctx context.Context, t time.Time) (int64, error) {
	res, err := d.W.ExecContext(ctx, `DELETE FROM login_attempts WHERE at < ?`, FormatTime(t))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
