// Command estudio runs the NethStore Estúdio API and its admin CLI.
//
//	estudio serve                 API and workers
//	estudio migrate               apply migrations and exit
//	estudio secret rotate         new access secret (shown once), revokes sessions
//	estudio sessions list         list sessions
//	estudio sessions revoke-all   delete every session
//	estudio healthcheck           container health probe
//	estudio backup > estudio.db   consistent database copy to stdout
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/nethstore/estudio/api/internal/auth"
	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/config"
	"github.com/nethstore/estudio/api/internal/httpapi"
	"github.com/nethstore/estudio/api/internal/jobs"
	"github.com/nethstore/estudio/api/internal/stamp"
	"github.com/nethstore/estudio/api/internal/storage"
	"github.com/nethstore/estudio/api/internal/store"
)

const usage = `usage: estudio <command>

commands:
  serve                 run the API and the workers
  migrate               apply database migrations and exit
  secret rotate         generate a new access secret (shown once) and revoke all sessions
  sessions list         list active sessions
  sessions revoke-all   revoke every session
  healthcheck           exit 0 when the local API answers /api/health
  backup                write a consistent copy of the database to stdout
`

// CLI output helpers: a failed write to the terminal is not actionable.
func out(w io.Writer, a ...any)                 { _, _ = fmt.Fprint(w, a...) }
func outln(w io.Writer, a ...any)               { _, _ = fmt.Fprintln(w, a...) }
func outf(w io.Writer, format string, a ...any) { _, _ = fmt.Fprintf(w, format, a...) }

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		outln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		out(stderr, usage)
		return errors.New("missing command")
	}
	switch args[0] {
	case "serve":
		return serve()
	case "migrate":
		return withDB(func(ctx context.Context, db *store.DB) error {
			outln(stdout, "migrations applied")
			return nil
		})
	case "secret":
		if len(args) < 2 || args[1] != "rotate" {
			out(stderr, usage)
			return errors.New("unknown secret command")
		}
		return withDB(func(ctx context.Context, db *store.DB) error {
			svc := auth.NewService(db, time.Hour, false, slog.New(slog.NewJSONHandler(io.Discard, nil)))
			secret, err := svc.Rotate(ctx)
			if err != nil {
				return err
			}
			outln(stdout, "Nova chave de acesso (mostrada só desta vez):")
			outln(stdout)
			outln(stdout, "  "+secret)
			outln(stdout)
			outln(stdout, "Todas as sessões foram terminadas.")
			return nil
		})
	case "sessions":
		if len(args) < 2 {
			out(stderr, usage)
			return errors.New("missing sessions command")
		}
		switch args[1] {
		case "list":
			return withDB(func(ctx context.Context, db *store.DB) error {
				list, err := db.ListSessions(ctx)
				if err != nil {
					return err
				}
				if len(list) == 0 {
					outln(stdout, "no sessions")
				}
				for _, s := range list {
					outf(stdout, "%x  created %s  expires %s  last seen %s  %s\n", s.TokenHash[:6],
						s.CreatedAt.Format(time.RFC3339), s.ExpiresAt.Format(time.RFC3339), s.LastSeenAt.Format(time.RFC3339), s.UserAgent)
				}
				return nil
			})
		case "revoke-all":
			return withDB(func(ctx context.Context, db *store.DB) error {
				n, err := db.DeleteAllSessions(ctx)
				if err != nil {
					return err
				}
				outf(stdout, "%d sessions revoked\n", n)
				return nil
			})
		}
		out(stderr, usage)
		return errors.New("unknown sessions command")
	case "healthcheck":
		return healthcheck()
	case "backup":
		// Consistent copy (VACUUM INTO) streamed to stdout: estudio backup > estudio.db
		return withDB(func(ctx context.Context, db *store.DB) error {
			tmp, err := os.MkdirTemp("", "estudio-backup-")
			if err != nil {
				return err
			}
			defer func() { _ = os.RemoveAll(tmp) }()
			if err := db.Backup(ctx, tmp+"/estudio.db"); err != nil {
				return err
			}
			root, err := os.OpenRoot(tmp)
			if err != nil {
				return err
			}
			defer func() { _ = root.Close() }()
			f, err := root.Open("estudio.db")
			if err != nil {
				return err
			}
			defer func() { _ = f.Close() }()
			_, err = io.Copy(stdout, f)
			return err
		})
	case "-h", "--help", "help":
		out(stdout, usage)
		return nil
	}
	out(stderr, usage)
	return fmt.Errorf("unknown command %q", args[0])
}

func withDB(fn func(ctx context.Context, db *store.DB) error) error {
	path, err := config.LoadForCLI(os.Getenv)
	if err != nil {
		return err
	}
	db, err := store.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	ctx := context.Background()
	if err := db.Migrate(ctx); err != nil {
		return err
	}
	return fn(ctx, db)
}

func healthcheck() error {
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("LISTEN_ADDR: %w", err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("LISTEN_ADDR: invalid port %q", portStr)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// Local probe of our own port, taken from our own configuration.
	url := fmt.Sprintf("http://127.0.0.1:%d/api/health", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil) // #nosec G704 -- loopback only, numeric port
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req) // #nosec G704 -- loopback only, numeric port
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health status %d", resp.StatusCode)
	}
	return nil
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	_ = l.UnmarshalText([]byte(level))
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}

func serve() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	log := newLogger(cfg.LogLevel)

	db, err := store.Open(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := db.Migrate(ctx); err != nil {
		return err
	}
	if _, err := db.SecretHash(ctx); errors.Is(err, store.ErrNotFound) {
		log.Warn("no access secret yet: run `make secret` (estudio secret rotate)")
	}

	st := storage.New(storage.Config{
		Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, Bucket: cfg.S3Bucket,
		AccessKeyID: cfg.S3AccessKeyID, SecretAccessKey: cfg.S3SecretAccessKey,
		UploadPath: cfg.UploadPath, MaxUploadBytes: cfg.MaxUploadBytes,
	})
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	if err := st.Ping(pingCtx); err != nil {
		log.Warn("storage not reachable at startup", "err", err)
	}
	cancel()

	authSvc := auth.NewService(db, cfg.SessionTTL, cfg.LoginGlobalLockout, log)
	proc := &jobs.Processor{DB: db, Storage: st, MaxBytes: cfg.MaxUploadBytes, Layout: stamp.DefaultLayout(), Now: time.Now, Log: log}
	pool := jobs.NewPool(db, proc, cfg.Workers, log)
	batchSvc := &batches.Service{
		DB: db, Storage: st, Now: time.Now, MaxPhotos: cfg.MaxPhotosPerBatch,
		MinBytes: 1024, MaxBytes: cfg.MaxUploadBytes, Notify: pool.Notify,
	}
	janitor := &jobs.Janitor{
		DB: db, Storage: st, Now: time.Now, Log: log,
		OriginalsMaxAge: time.Duration(cfg.RetentionOriginalsDays) * 24 * time.Hour,
		BatchesMaxAge:   time.Duration(cfg.RetentionBatchesDays) * 24 * time.Hour,
	}

	srv := httpapi.New(cfg, authSvc, batchSvc, st, log).HTTPServer()
	pool.Start()
	janitorCtx, stopJanitor := context.WithCancel(context.Background())
	go janitor.Run(janitorCtx)

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.ListenAddr, "mode", cfg.DeployMode, "workers", cfg.Workers)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		log.Info("shutting down")
	case err := <-errCh:
		if err != nil {
			stopJanitor()
			_ = pool.Shutdown(context.Background())
			return err
		}
	}

	stopJanitor()
	httpCtx, cancelHTTP := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelHTTP()
	if err := srv.Shutdown(httpCtx); err != nil {
		log.Warn("http shutdown", "err", err)
	}
	poolCtx, cancelPool := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelPool()
	if err := pool.Shutdown(poolCtx); err != nil {
		log.Warn("workers did not finish in time", "err", err)
	}
	log.Info("stopped")
	return nil
}
