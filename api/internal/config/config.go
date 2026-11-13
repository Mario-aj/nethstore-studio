// Package config loads and validates the runtime configuration from the
// environment. Invalid or missing values stop the process at startup.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Deploy modes. See docs/DECISOES.md.
const (
	ModeLAN    = "lan"
	ModePublic = "public"
)

// Config is the validated runtime configuration.
type Config struct {
	DeployMode             string
	AppOrigin              string
	ListenAddr             string
	DatabasePath           string
	S3Endpoint             string
	S3Region               string
	S3Bucket               string
	S3AccessKeyID          string
	S3SecretAccessKey      string
	UploadPath             string
	MaxUploadBytes         int64
	MaxPhotosPerBatch      int
	SessionTTL             time.Duration
	Workers                int
	RetentionOriginalsDays int
	RetentionBatchesDays   int
	LoginGlobalLockout     bool
	TrustedProxyHost       string
	LogLevel               string
}

// Getenv abstracts os.Getenv so tests can inject values.
type Getenv func(string) string

// Load reads the configuration from the process environment.
func Load() (Config, error) { return LoadFrom(os.Getenv) }

// LoadFrom reads the configuration using the given lookup function.
func LoadFrom(get Getenv) (Config, error) {
	var errs []error
	str := func(key, def string, required bool) string {
		v := strings.TrimSpace(get(key))
		if v == "" {
			v = def
		}
		if v == "" && required {
			errs = append(errs, fmt.Errorf("%s is required", key))
		}
		return v
	}
	num := func(key string, def, minV, maxV int64) int64 {
		raw := strings.TrimSpace(get(key))
		if raw == "" {
			return def
		}
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < minV || n > maxV {
			errs = append(errs, fmt.Errorf("%s must be an integer between %d and %d", key, minV, maxV))
			return def
		}
		return n
	}

	c := Config{
		DeployMode:        str("DEPLOY_MODE", ModeLAN, true),
		AppOrigin:         strings.TrimRight(str("APP_ORIGIN", "", true), "/"),
		ListenAddr:        str("LISTEN_ADDR", ":8080", true),
		DatabasePath:      str("DATABASE_PATH", "", true),
		S3Endpoint:        str("S3_ENDPOINT", "", true),
		S3Region:          str("S3_REGION", "garage", true),
		S3Bucket:          str("S3_BUCKET", "estudio", true),
		S3AccessKeyID:     str("S3_ACCESS_KEY_ID", "", true),
		S3SecretAccessKey: str("S3_SECRET_ACCESS_KEY", "", true),
		UploadPath:        str("UPLOAD_PATH", "/s3/estudio", true),
		TrustedProxyHost:  str("TRUSTED_PROXY_HOST", "", false),
		LogLevel:          str("LOG_LEVEL", "info", true),
	}
	c.MaxUploadBytes = num("MAX_UPLOAD_BYTES", 15<<20, 1024, 64<<20)
	c.MaxPhotosPerBatch = int(num("MAX_PHOTOS_PER_BATCH", 50, 1, 50))
	c.Workers = int(num("WORKERS", 2, 1, 32))
	c.RetentionOriginalsDays = int(num("RETENTION_ORIGINALS_DAYS", 30, 1, 3650))
	c.RetentionBatchesDays = int(num("RETENTION_BATCHES_DAYS", 90, 1, 3650))

	ttlRaw := str("SESSION_TTL", "720h", true)
	ttl, err := time.ParseDuration(ttlRaw)
	if err != nil || ttl < time.Hour || ttl > 24*90*time.Hour {
		errs = append(errs, errors.New("SESSION_TTL must be a duration between 1h and 2160h"))
	}
	c.SessionTTL = ttl

	switch c.DeployMode {
	case ModeLAN, ModePublic:
	default:
		errs = append(errs, errors.New("DEPLOY_MODE must be lan or public"))
	}

	lockRaw := strings.ToLower(strings.TrimSpace(get("LOGIN_GLOBAL_LOCKOUT")))
	switch lockRaw {
	case "":
		c.LoginGlobalLockout = c.DeployMode == ModeLAN
	case "true", "1", "yes":
		c.LoginGlobalLockout = true
	case "false", "0", "no":
		c.LoginGlobalLockout = false
	default:
		errs = append(errs, errors.New("LOGIN_GLOBAL_LOCKOUT must be true or false"))
	}

	if c.AppOrigin != "" {
		u, err := url.Parse(c.AppOrigin)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.Path != "" || u.RawQuery != "" {
			errs = append(errs, errors.New("APP_ORIGIN must be an https origin like https://192.168.1.50"))
		}
	}
	if c.S3Endpoint != "" {
		if u, err := url.Parse(c.S3Endpoint); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, errors.New("S3_ENDPOINT must be an http(s) URL"))
		}
	}
	if !strings.HasPrefix(c.UploadPath, "/") {
		errs = append(errs, errors.New("UPLOAD_PATH must start with /"))
	}
	if c.RetentionBatchesDays < c.RetentionOriginalsDays {
		errs = append(errs, errors.New("RETENTION_BATCHES_DAYS must be >= RETENTION_ORIGINALS_DAYS"))
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		errs = append(errs, errors.New("LOG_LEVEL must be debug, info, warn or error"))
	}
	return c, errors.Join(errs...)
}

// LoadForCLI loads only what the admin CLI needs (the database path).
func LoadForCLI(get Getenv) (string, error) {
	p := strings.TrimSpace(get("DATABASE_PATH"))
	if p == "" {
		return "", errors.New("DATABASE_PATH is required")
	}
	return p, nil
}
