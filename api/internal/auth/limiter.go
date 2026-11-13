package auth

import (
	"context"
	"time"
)

// Limits from SPEC 12.3.
const (
	PerMinuteLimit   = 5
	PerMinuteWindow  = time.Minute
	IPFailureLimit   = 10
	IPFailureWindow  = 15 * time.Minute
	IPLockDuration   = 15 * time.Minute
	GlobalFailLimit  = 30 // more than this in the window locks login
	GlobalFailWindow = time.Hour
	GlobalLockFor    = time.Hour
)

// AttemptStore is the persistence the limiter needs.
type AttemptStore interface {
	AttemptTimes(ctx context.Context, ip string, since time.Time, failuresOnly bool) ([]time.Time, error)
	GlobalFailureTimes(ctx context.Context, since time.Time) ([]time.Time, error)
	RecordLoginAttempt(ctx context.Context, ip string, at time.Time, success bool) error
}

// Limiter decides whether a login attempt may be evaluated.
type Limiter struct {
	Store         AttemptStore
	GlobalLockout bool
}

// Decision is the limiter verdict for one IP at one instant.
type Decision struct {
	Allowed bool
	// RetryAfter is set when not allowed.
	RetryAfter time.Duration
	// Global is true when the global lock caused the refusal.
	Global bool
}

// Check evaluates the limits for ip at now. Refused attempts are not
// recorded, so hammering does not extend the lock.
func (l *Limiter) Check(ctx context.Context, ip string, now time.Time) (Decision, error) {
	var until time.Time

	recent, err := l.Store.AttemptTimes(ctx, ip, now.Add(-PerMinuteWindow), false)
	if err != nil {
		return Decision{}, err
	}
	if len(recent) >= PerMinuteLimit {
		// The window frees a slot when the attempt that makes the count reach
		// the limit leaves it.
		t := recent[len(recent)-PerMinuteLimit].Add(PerMinuteWindow)
		until = later(until, t)
	}

	fails, err := l.Store.AttemptTimes(ctx, ip, now.Add(-(IPFailureWindow + IPLockDuration)), true)
	if err != nil {
		return Decision{}, err
	}
	until = later(until, lockUntil(fails, IPFailureLimit, IPFailureWindow, IPLockDuration))

	global := false
	if l.GlobalLockout {
		gf, err := l.Store.GlobalFailureTimes(ctx, now.Add(-(GlobalFailWindow + GlobalLockFor)))
		if err != nil {
			return Decision{}, err
		}
		g := lockUntil(gf, GlobalFailLimit+1, GlobalFailWindow, GlobalLockFor)
		if g.After(now) && g.After(until) {
			global = true
		}
		until = later(until, g)
	}

	if until.After(now) {
		return Decision{RetryAfter: until.Sub(now), Global: global}, nil
	}
	return Decision{Allowed: true}, nil
}

// Remaining returns how many attempts ip still has before being refused,
// counting both the per-minute and the 15-minute failure limits.
func (l *Limiter) Remaining(ctx context.Context, ip string, now time.Time) (int, error) {
	recent, err := l.Store.AttemptTimes(ctx, ip, now.Add(-PerMinuteWindow), false)
	if err != nil {
		return 0, err
	}
	fails, err := l.Store.AttemptTimes(ctx, ip, now.Add(-IPFailureWindow), true)
	if err != nil {
		return 0, err
	}
	r := min(PerMinuteLimit-len(recent), IPFailureLimit-len(fails))
	return max(r, 0), nil
}

// Record stores an evaluated attempt.
func (l *Limiter) Record(ctx context.Context, ip string, now time.Time, success bool) error {
	return l.Store.RecordLoginAttempt(ctx, ip, now, success)
}

// GlobalFailures returns how many failures happened in the last hour.
func (l *Limiter) GlobalFailures(ctx context.Context, now time.Time) (int, error) {
	gf, err := l.Store.GlobalFailureTimes(ctx, now.Add(-GlobalFailWindow))
	return len(gf), err
}

// lockUntil returns the end of the latest lock triggered by `limit` events
// inside `window`, or the zero time. times must be sorted ascending.
func lockUntil(times []time.Time, limit int, window, lock time.Duration) time.Time {
	var until time.Time
	for i := limit - 1; i < len(times); i++ {
		if times[i].Sub(times[i-limit+1]) < window {
			until = later(until, times[i].Add(lock))
		}
	}
	return until
}

func later(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}
