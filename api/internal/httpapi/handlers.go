package httpapi

import (
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/nethstore/estudio/api/internal/auth"
	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/storage"
)

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) appConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"deployMode": s.Cfg.DeployMode})
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, msg string, err error) {
	s.Log.ErrorContext(r.Context(), msg, "request_id", requestIDFrom(r.Context()), "err", err)
	writeErr(w, http.StatusInternalServerError, "internal", "internal error")
}

// --- auth -------------------------------------------------------------------

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Secret string `json:"secret"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	res, err := s.Auth.Login(r.Context(), s.clientIP(r), r.UserAgent(), body.Secret)
	var invalid *auth.InvalidSecretError
	var tooMany *auth.TooManyAttemptsError
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrInvalidFormat):
		writeErr(w, http.StatusBadRequest, "invalid_format", "secret must have 32 base62 characters")
		return
	case errors.As(err, &invalid):
		rem := invalid.Remaining
		writeAPIError(w, http.StatusUnauthorized, apiError{Code: "invalid_secret", Message: "invalid secret", RemainingAttempts: &rem})
		return
	case errors.As(err, &tooMany):
		secs := int(math.Ceil(tooMany.RetryAfter.Seconds()))
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		writeAPIError(w, http.StatusTooManyRequests, apiError{Code: "too_many_attempts", Message: "too many attempts", RetryAfterSeconds: &secs})
		return
	case errors.Is(err, auth.ErrNoSecret):
		// Same answer as a wrong secret: nothing to learn from the outside.
		s.Log.ErrorContext(r.Context(), "login without configured secret; run `estudio secret rotate`")
		zero := 0
		writeAPIError(w, http.StatusUnauthorized, apiError{Code: "invalid_secret", Message: "invalid secret", RemainingAttempts: &zero})
		return
	default:
		s.internalError(w, r, "login", err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookie,
		Value:    res.Token,
		Path:     "/",
		MaxAge:   int(s.Cfg.SessionTTL.Seconds()),
		Expires:  res.ExpiresAt,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	token, _ := r.Context().Value(ctxToken).(string)
	if err := s.Auth.Logout(r.Context(), token); err != nil {
		s.internalError(w, r, "logout", err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: SessionCookie, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(0, 0),
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	sess, _ := sessionFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "expiresAt": sess.ExpiresAt.UTC().Truncate(time.Second)})
}

// --- batches ----------------------------------------------------------------

func pathID(w http.ResponseWriter, r *http.Request) (string, bool) {
	raw := r.PathValue("id")
	id, err := uuid.Parse(raw)
	if err != nil || len(raw) != 36 {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be a UUID")
		return "", false
	}
	return id.String(), true
}

// batchError maps use-case errors to responses; it returns false when err
// was not one of them.
func (s *Server) batchError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *batches.ValidationError
	switch {
	case errors.As(err, &ve):
		writeErr(w, http.StatusBadRequest, ve.Code, ve.Message)
	case errors.Is(err, batches.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, batches.ErrNotReady):
		writeErr(w, http.StatusNotFound, "not_ready", "photo is not ready")
	case errors.Is(err, batches.ErrInvalidState):
		writeErr(w, http.StatusConflict, "invalid_state", "action not allowed in the current state")
	case errors.Is(err, batches.ErrObjectMissing):
		writeErr(w, http.StatusConflict, "object_missing", "uploaded object not found")
	case errors.Is(err, batches.ErrInvalidObjectSize):
		writeErr(w, http.StatusConflict, "invalid_object_size", "uploaded object size outside limits")
	case errors.Is(err, batches.ErrTooManyOpenBatches):
		writeErr(w, http.StatusTooManyRequests, "too_many_open_batches", "too many batches waiting for uploads")
	default:
		s.Log.ErrorContext(r.Context(), "batch operation", "request_id", requestIDFrom(r.Context()), "err", err)
		writeErr(w, http.StatusServiceUnavailable, "storage_unavailable", "storage or database unavailable")
	}
}

func (s *Server) createBatch(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErr(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body is too large")
			return
		}
		writeErr(w, http.StatusBadRequest, "invalid_json", "could not read body")
		return
	}
	in, err := batches.ParseCreate(body, s.Cfg.MaxPhotosPerBatch)
	if err != nil {
		s.batchError(w, r, err)
		return
	}
	out, err := s.Batches.Create(r.Context(), in)
	if err != nil {
		s.batchError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) listBatches(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 50 {
			writeErr(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 50")
			return
		}
		limit = n
	}
	var before int64
	if v := r.URL.Query().Get("before"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			writeErr(w, http.StatusBadRequest, "invalid_before", "before must be a positive batch number")
			return
		}
		before = n
	}
	page, err := s.Batches.List(r.Context(), limit, before)
	if err != nil {
		s.batchError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) getBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := s.Batches.Get(r.Context(), id)
	if err != nil {
		s.batchError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) deleteBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Batches.Delete(r.Context(), id); err != nil {
		s.batchError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- photos -----------------------------------------------------------------

func (s *Server) photoUploaded(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Batches.ConfirmUpload(r.Context(), id); err != nil {
		s.batchError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) photoUploadSlot(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	up, err := s.Batches.UploadSlot(r.Context(), id)
	if err != nil {
		s.batchError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, up)
}

func (s *Server) photoUploadFailed(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Batches.UploadFailed(r.Context(), id); err != nil {
		s.batchError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) photoRetry(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Batches.Retry(r.Context(), id); err != nil {
		s.batchError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) photoThumb(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ref, fallbacks, err := s.Batches.Thumb(r.Context(), id)
	if err != nil {
		s.batchError(w, r, err)
		return
	}
	keys := append([]string{ref.Key}, fallbacks...)
	s.streamFirst(w, r, keys, "")
}

func (s *Server) photoStamped(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ref, err := s.Batches.Stamped(r.Context(), id)
	if err != nil {
		s.batchError(w, r, err)
		return
	}
	s.streamFirst(w, r, []string{ref.Key}, ref.Filename)
}

// streamFirst streams the first existing object among keys, without loading
// it in memory.
func (s *Server) streamFirst(w http.ResponseWriter, r *http.Request, keys []string, filename string) {
	for _, key := range keys {
		obj, err := s.Objects.Get(r.Context(), key)
		if errors.Is(err, storage.ErrNotFound) {
			continue
		}
		if err != nil {
			s.batchError(w, r, err)
			return
		}
		defer func() { _ = obj.Body.Close() }()
		h := w.Header()
		h.Set("Content-Type", "image/jpeg")
		h.Set("Cache-Control", "private, max-age=3600")
		if obj.Size > 0 {
			h.Set("Content-Length", strconv.FormatInt(obj.Size, 10))
		}
		if filename != "" {
			h.Set("Content-Disposition", `attachment; filename="`+filename+`"`)
		}
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return
		}
		if _, err := io.Copy(w, obj.Body); err != nil {
			s.Log.WarnContext(r.Context(), "stream image interrupted", "request_id", requestIDFrom(r.Context()), "err", err)
		}
		return
	}
	writeErr(w, http.StatusNotFound, "not_found", "image not found")
}
