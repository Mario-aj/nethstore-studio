// Package store owns the SQLite database: connections, migrations and queries.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite" // database/sql driver "sqlite"

	"github.com/nethstore/estudio/api/migrations"
)

// TimeLayout is RFC 3339 in UTC with fixed millisecond precision, so string
// comparison in SQL matches chronological order.
const TimeLayout = "2006-01-02T15:04:05.000Z"

// FormatTime renders t in TimeLayout (UTC).
func FormatTime(t time.Time) string { return t.UTC().Format(TimeLayout) }

// ParseTime parses a value written by FormatTime.
func ParseTime(s string) (time.Time, error) { return time.Parse(TimeLayout, s) }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

// DB holds a single-connection writer pool and a reader pool.
type DB struct {
	W *sql.DB
	R *sql.DB
}

// Open opens (and creates) the database at path. Use ":memory:"-like paths only
// through OpenMemory in tests.
func Open(path string) (*DB, error) {
	pragmas := "_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	w, err := sql.Open("sqlite", "file:"+path+"?"+pragmas+"&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	w.SetMaxIdleConns(1)
	w.SetConnMaxLifetime(0)

	r, err := sql.Open("sqlite", "file:"+path+"?"+pragmas+"&mode=ro")
	if err != nil {
		_ = w.Close()
		return nil, err
	}
	r.SetMaxOpenConns(4)

	if err := w.PingContext(context.Background()); err != nil {
		_ = w.Close()
		_ = r.Close()
		return nil, fmt.Errorf("open database: %w", err)
	}
	return &DB{W: w, R: r}, nil
}

// OpenMemory opens a private shared-cache in-memory database (tests).
func OpenMemory(name string) (*DB, error) {
	dsn := "file:" + url.PathEscape(name) + "?mode=memory&cache=shared&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"
	w, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	// Same handle for reads: an in-memory DB disappears with its last connection.
	return &DB{W: w, R: w}, nil
}

// Close closes both pools.
func (d *DB) Close() error {
	if d.R == d.W {
		return d.W.Close()
	}
	return errors.Join(d.R.Close(), d.W.Close())
}

// Migrate applies the embedded migrations in order, once each.
func (d *DB) Migrate(ctx context.Context) error {
	if _, err := d.W.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	names, err := fs.Glob(migrations.FS, "*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		version := strings.TrimSuffix(name, ".sql")
		var exists int
		if err := d.W.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		body, err := migrations.FS.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := d.W.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, version, FormatTime(time.Now())); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// Backup writes a consistent copy of the database to dst (VACUUM INTO).
func (d *DB) Backup(ctx context.Context, dst string) error {
	_, err := d.W.ExecContext(ctx, `VACUUM INTO ?`, dst)
	return err
}
