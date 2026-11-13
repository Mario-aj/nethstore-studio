package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/nethstore/estudio/api/internal/auth"
	"github.com/nethstore/estudio/api/internal/store"
)

// MaxBodyBytes is the JSON body limit (SPEC 7).
const MaxBodyBytes = 64 << 10

type ctxKey int

const (
	ctxRequestID ctxKey = iota
	ctxSession
	ctxToken
)

// SessionCookie is the session cookie name (SPEC 12.4).
const SessionCookie = "__Host-sid"

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += int64(n)
	return n, err
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func newRequestID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// requestIDFrom returns the request id stored in ctx.
func requestIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxRequestID).(string)
	return v
}

// observe adds a request id, recovers panics and logs one line per request.
// It never logs headers, cookies, bodies or query strings.
func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		ctx := context.WithValue(r.Context(), ctxRequestID, id)
		r = r.WithContext(ctx)
		w.Header().Set("X-Request-Id", id)
		rec := &statusRecorder{ResponseWriter: w}
		start := time.Now()
		defer func() {
			if v := recover(); v != nil {
				s.Log.ErrorContext(ctx, "panic", "request_id", id, "panic", fmt.Sprint(v), "stack", string(debug.Stack()))
				if rec.status == 0 {
					writeErr(rec, http.StatusInternalServerError, "internal", "internal error")
				}
			}
			level := slog.LevelInfo
			if r.URL.Path == "/api/health" && rec.status == http.StatusOK {
				level = slog.LevelDebug // container health probes every 10 s
			}
			if rec.status >= 500 {
				level = slog.LevelError
			}
			s.Log.Log(ctx, level, "request",
				"request_id", id, "method", r.Method, "path", r.URL.Path, "status", rec.status,
				"bytes", rec.bytes, "duration_ms", time.Since(start).Milliseconds(), "ip", s.clientIP(r))
		}()
		next.ServeHTTP(rec, r)
	})
}

// apiHeaders sets the default API response headers.
func apiHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func isUnsafeMethod(m string) bool {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}

// guardWrites enforces Origin and Content-Type on state-changing methods and
// limits every request body.
func (s *Server) guardWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isUnsafeMethod(r.Method) {
			if r.Header.Get("Origin") != s.Cfg.AppOrigin {
				writeErr(w, http.StatusForbidden, "forbidden_origin", "origin not allowed")
				return
			}
			ct := r.Header.Get("Content-Type")
			hasBody := r.ContentLength > 0 || r.ContentLength == -1 && len(r.TransferEncoding) > 0
			if ct != "" || hasBody {
				mt, _, err := mime.ParseMediaType(ct)
				if err != nil || mt != "application/json" {
					writeErr(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "content type must be application/json")
					return
				}
			}
			if r.ContentLength > MaxBodyBytes {
				writeErr(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body is too large")
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
		next.ServeHTTP(w, r)
	})
}

// requireSession rejects requests without a valid session.
func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(SessionCookie)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthenticated", "authentication required")
			return
		}
		sess, err := s.Auth.Authenticate(r.Context(), c.Value)
		if err != nil {
			if !errors.Is(err, auth.ErrUnauthenticated) {
				s.Log.ErrorContext(r.Context(), "authenticate", "request_id", requestIDFrom(r.Context()), "err", err)
			}
			writeErr(w, http.StatusUnauthorized, "unauthenticated", "authentication required")
			return
		}
		ctx := context.WithValue(r.Context(), ctxSession, sess)
		ctx = context.WithValue(ctx, ctxToken, c.Value)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func sessionFrom(ctx context.Context) (store.Session, bool) {
	s, ok := ctx.Value(ctxSession).(store.Session)
	return s, ok
}

// proxyResolver resolves the reverse proxy host to IPs, cached for a while.
type proxyResolver struct {
	host string
	ttl  time.Duration

	mu      sync.Mutex
	ips     map[string]bool
	fetched time.Time
}

func (p *proxyResolver) isProxy(ip string) bool {
	if p == nil || p.host == "" {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if time.Since(p.fetched) > p.ttl {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		addrs, err := net.DefaultResolver.LookupHost(ctx, p.host)
		cancel()
		if err == nil {
			p.ips = make(map[string]bool, len(addrs))
			for _, a := range addrs {
				p.ips[canonicalIP(a)] = true
			}
		}
		p.fetched = time.Now()
	}
	return p.ips[ip]
}

func canonicalIP(s string) string {
	if ip := net.ParseIP(s); ip != nil {
		return ip.String()
	}
	return s
}

// clientIP returns the peer IP; when the peer is the reverse proxy it uses
// the last X-Forwarded-For value (the proxy discards client-sent values).
func (s *Server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	host = canonicalIP(host)
	if s.proxy.isProxy(host) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if last := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(last) != nil {
				return canonicalIP(last)
			}
		}
	}
	return host
}
