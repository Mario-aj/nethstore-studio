// Package httpapi exposes the JSON API under /api.
package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/nethstore/estudio/api/internal/auth"
	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/config"
	"github.com/nethstore/estudio/api/internal/storage"
)

// ObjectReader streams objects for the image routes.
type ObjectReader interface {
	Get(ctx context.Context, key string) (storage.Object, error)
}

// Server holds the handler dependencies.
type Server struct {
	Cfg     config.Config
	Auth    *auth.Service
	Batches *batches.Service
	Objects ObjectReader
	Log     *slog.Logger
	proxy   *proxyResolver
}

// New builds a Server.
func New(cfg config.Config, a *auth.Service, b *batches.Service, objects ObjectReader, log *slog.Logger) *Server {
	return &Server{
		Cfg: cfg, Auth: a, Batches: b, Objects: objects, Log: log,
		proxy: &proxyResolver{host: cfg.TrustedProxyHost, ttl: 30 * time.Second},
	}
}

// Route is one entry of the route table.
type Route struct {
	Method  string
	Pattern string
	Public  bool
	Handler http.HandlerFunc
}

// Routes is the full route table; tests walk it (SPEC 12.8 item 1).
func (s *Server) Routes() []Route {
	return []Route{
		{http.MethodGet, "/api/health", true, s.health},
		{http.MethodGet, "/api/config", true, s.appConfig},
		{http.MethodPost, "/api/auth/login", true, s.login},
		{http.MethodPost, "/api/auth/logout", false, s.logout},
		{http.MethodGet, "/api/auth/me", false, s.me},
		{http.MethodPost, "/api/batches", false, s.createBatch},
		{http.MethodGet, "/api/batches", false, s.listBatches},
		{http.MethodGet, "/api/batches/{id}", false, s.getBatch},
		{http.MethodDelete, "/api/batches/{id}", false, s.deleteBatch},
		{http.MethodPost, "/api/photos/{id}/uploaded", false, s.photoUploaded},
		{http.MethodPost, "/api/photos/{id}/upload-slot", false, s.photoUploadSlot},
		{http.MethodPost, "/api/photos/{id}/upload-failed", false, s.photoUploadFailed},
		{http.MethodPost, "/api/photos/{id}/retry", false, s.photoRetry},
		{http.MethodGet, "/api/photos/{id}/thumb", false, s.photoThumb},
		{http.MethodGet, "/api/photos/{id}/stamped", false, s.photoStamped},
	}
}

// Handler returns the API handler with every middleware applied.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	paths := map[string]bool{}
	for _, rt := range s.Routes() {
		var h http.Handler = rt.Handler
		if !rt.Public {
			h = s.requireSession(h)
		}
		mux.Handle(rt.Method+" "+rt.Pattern, h)
		paths[rt.Pattern] = true
	}
	// Same paths without a method: answer 405 in the JSON error format.
	for p := range paths {
		mux.HandleFunc(p, func(w http.ResponseWriter, _ *http.Request) {
			writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		})
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeErr(w, http.StatusNotFound, "not_found", "not found")
	})
	return s.observe(apiHeaders(s.guardWrites(mux)))
}

// HTTPServer wraps the handler with the SPEC 12.5 timeouts.
func (s *Server) HTTPServer() *http.Server {
	return &http.Server{
		Addr:              s.Cfg.ListenAddr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(s.Log.Handler(), slog.LevelWarn),
	}
}
