package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Job statuses.
const (
	JobQueued  = "queued"
	JobRunning = "running"
	JobDone    = "done"
	JobFailed  = "failed"
)

// Job is a reserved unit of work.
type Job struct {
	ID       int64
	PhotoID  string
	Attempts int
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func enqueue(ctx context.Context, ex execer, photoID string, now time.Time) error {
	_, err := ex.ExecContext(ctx, `INSERT INTO jobs (photo_id, kind, status, attempts, run_after, created_at) VALUES (?, 'process', ?, 0, ?, ?)`,
		photoID, JobQueued, FormatTime(now), FormatTime(now))
	return err
}

// ReserveJob atomically claims the oldest runnable job. It returns
// ErrNotFound when there is nothing to do.
func (d *DB) ReserveJob(ctx context.Context, now time.Time) (Job, error) {
	var j Job
	ts := FormatTime(now)
	err := d.W.QueryRowContext(ctx, `UPDATE jobs
		   SET status = 'running', locked_at = ?, attempts = attempts + 1
		 WHERE id = (SELECT id FROM jobs
		              WHERE status = 'queued' AND run_after <= ?
		              ORDER BY id LIMIT 1)
		RETURNING id, photo_id, attempts`, ts, ts).Scan(&j.ID, &j.PhotoID, &j.Attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return j, ErrNotFound
	}
	return j, err
}

// CompleteJob marks a job done.
func (d *DB) CompleteJob(ctx context.Context, id int64) error {
	_, err := d.W.ExecContext(ctx, `UPDATE jobs SET status = 'done', locked_at = NULL, last_error = NULL WHERE id = ?`, id)
	return err
}

// FailJob marks a job permanently failed.
func (d *DB) FailJob(ctx context.Context, id int64, lastErr string) error {
	_, err := d.W.ExecContext(ctx, `UPDATE jobs SET status = 'failed', locked_at = NULL, last_error = ? WHERE id = ?`, truncate(lastErr, 500), id)
	return err
}

// RescheduleJob puts a job back in the queue to run after t.
func (d *DB) RescheduleJob(ctx context.Context, id int64, runAfter time.Time, lastErr string) error {
	_, err := d.W.ExecContext(ctx, `UPDATE jobs SET status = 'queued', locked_at = NULL, run_after = ?, last_error = ? WHERE id = ?`,
		FormatTime(runAfter), truncate(lastErr, 500), id)
	return err
}

// RequeueStuck returns running jobs locked before cutoff to the queue.
func (d *DB) RequeueStuck(ctx context.Context, cutoff, now time.Time) (int64, error) {
	res, err := d.W.ExecContext(ctx, `UPDATE jobs SET status = 'queued', locked_at = NULL, run_after = ? WHERE status = 'running' AND locked_at < ?`,
		FormatTime(now), FormatTime(cutoff))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// JobByID loads a job's status and attempts (tests and diagnostics).
func (d *DB) JobByID(ctx context.Context, id int64) (status string, attempts int, err error) {
	err = d.R.QueryRowContext(ctx, `SELECT status, attempts FROM jobs WHERE id = ?`, id).Scan(&status, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return status, attempts, err
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
