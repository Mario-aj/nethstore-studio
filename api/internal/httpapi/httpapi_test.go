package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image/color"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nethstore/estudio/api/internal/auth"
	"github.com/nethstore/estudio/api/internal/batches"
	"github.com/nethstore/estudio/api/internal/config"
	"github.com/nethstore/estudio/api/internal/jobs"
	"github.com/nethstore/estudio/api/internal/stamp"
	"github.com/nethstore/estudio/api/internal/store"
	"github.com/nethstore/estudio/api/internal/testutil"
)

const origin = "https://192.168.1.50"

type tenv struct {
	t      *testing.T
	srv    *Server
	h      http.Handler
	db     *store.DB
	st     *testutil.MemStorage
	clock  *testutil.Clock
	secret string
	logs   *bytes.Buffer
	bs     *batches.Service
}

func newEnv(t *testing.T) *tenv {
	t.Helper()
	e := &tenv{t: t, db: testutil.DB(t), st: testutil.NewMemStorage(), clock: testutil.NewClock(), logs: &bytes.Buffer{}}
	log := testutil.Logger(e.logs)
	cfg := config.Config{DeployMode: "lan", AppOrigin: origin, SessionTTL: 720 * time.Hour, MaxPhotosPerBatch: 50, MaxUploadBytes: 15 << 20}
	a := auth.NewService(e.db, cfg.SessionTTL, true, log)
	a.Now = e.clock.Now
	secret, err := a.Rotate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	e.secret = secret
	e.bs = &batches.Service{DB: e.db, Storage: e.st, Now: e.clock.Now, MaxPhotos: 50, MinBytes: 1024, MaxBytes: 15 << 20}
	e.srv = New(cfg, a, e.bs, e.st, log)
	e.h = e.srv.Handler()
	return e
}

type req struct {
	method, path, body string
	cookie             string
	origin             *string
	contentType        *string
	remote             string
	headers            map[string]string
}

func (e *tenv) do(r req) *httptest.ResponseRecorder {
	e.t.Helper()
	var body io.Reader
	if r.body != "" {
		body = strings.NewReader(r.body)
	}
	hr := httptest.NewRequest(r.method, r.path, body)
	if r.remote != "" {
		hr.RemoteAddr = r.remote
	}
	if isUnsafeMethod(r.method) {
		o := origin
		if r.origin != nil {
			o = *r.origin
		}
		if o != "" {
			hr.Header.Set("Origin", o)
		}
		ct := ""
		if r.body != "" {
			ct = "application/json"
		}
		if r.contentType != nil {
			ct = *r.contentType
		}
		if ct != "" {
			hr.Header.Set("Content-Type", ct)
		}
	}
	for k, v := range r.headers {
		hr.Header.Set(k, v)
	}
	if r.cookie != "" {
		hr.AddCookie(&http.Cookie{Name: SessionCookie, Value: r.cookie})
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, hr)
	return w
}

func (e *tenv) login() string {
	e.t.Helper()
	w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"` + e.secret + `"}`})
	if w.Code != http.StatusNoContent {
		e.t.Fatalf("login: %d %s", w.Code, w.Body)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == SessionCookie {
			return c.Value
		}
	}
	e.t.Fatal("no session cookie")
	return ""
}

func errCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error apiError `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("not an error body: %s", w.Body)
	}
	return body.Error.Code
}

func sp(s string) *string { return &s }

func TestPublicRoutes(t *testing.T) {
	e := newEnv(t)
	w := e.do(req{method: "GET", path: "/api/health"})
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"status":"ok"}` || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("health %d %s %v", w.Code, w.Body, w.Header())
	}
	w = e.do(req{method: "GET", path: "/api/config"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"deployMode":"lan"`) {
		t.Fatalf("config %d %s", w.Code, w.Body)
	}
	if w.Header().Get("X-Request-Id") == "" {
		t.Fatal("no request id")
	}
}

// SPEC 12.8 item 1.
func TestEveryProtectedRouteNeedsSession(t *testing.T) {
	e := newEnv(t)
	n := 0
	for _, rt := range e.srv.Routes() {
		if rt.Public {
			continue
		}
		n++
		path := strings.ReplaceAll(rt.Pattern, "{id}", "01933f6e-0000-7000-8000-000000000000")
		body := ""
		if isUnsafeMethod(rt.Method) {
			body = "{}"
		}
		for _, cookie := range []string{"", "forged-token"} {
			w := e.do(req{method: rt.Method, path: path, body: body, cookie: cookie})
			if w.Code != http.StatusUnauthorized || errCode(t, w) != "unauthenticated" {
				t.Errorf("%s %s (cookie %q): %d %s", rt.Method, path, cookie, w.Code, w.Body)
			}
		}
	}
	if n < 12 {
		t.Fatalf("only %d protected routes", n)
	}
}

// SPEC 12.8 item 2.
func TestCookieFlags(t *testing.T) {
	e := newEnv(t)
	w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"` + e.secret + `"}`})
	raw := w.Header().Get("Set-Cookie")
	for _, want := range []string{"__Host-sid=", "Path=/", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=2592000"} {
		if !strings.Contains(raw, want) {
			t.Errorf("Set-Cookie %q lacks %q", raw, want)
		}
	}
	if strings.Contains(raw, "Domain=") {
		t.Error("cookie has Domain")
	}
}

// SPEC 12.8 items 3 and 4.
func TestOriginAndContentType(t *testing.T) {
	e := newEnv(t)
	tok := e.login()
	cases := []struct {
		r    req
		code int
		ec   string
	}{
		{req{method: "POST", path: "/api/auth/login", body: `{}`, origin: sp("https://evil.example")}, 403, "forbidden_origin"},
		{req{method: "POST", path: "/api/batches", body: `{}`, cookie: tok, origin: sp("")}, 403, "forbidden_origin"},
		{req{method: "DELETE", path: "/api/batches/01933f6e-0000-7000-8000-000000000000", cookie: tok, origin: sp("http://192.168.1.50")}, 403, "forbidden_origin"},
		{req{method: "POST", path: "/api/auth/login", body: `{}`, contentType: sp("text/plain")}, 415, "unsupported_media_type"},
		{req{method: "POST", path: "/api/batches", body: `a=b`, cookie: tok, contentType: sp("application/x-www-form-urlencoded")}, 415, "unsupported_media_type"},
		{req{method: "POST", path: "/api/batches", body: `{}`, cookie: tok, contentType: sp("")}, 415, "unsupported_media_type"},
	}
	for _, c := range cases {
		w := e.do(c.r)
		if w.Code != c.code || errCode(t, w) != c.ec {
			t.Errorf("%s %s: %d %s", c.r.method, c.r.path, w.Code, w.Body)
		}
	}
	// application/json with charset is fine.
	w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"x"}`, contentType: sp("application/json; charset=utf-8")})
	if w.Code != 400 || errCode(t, w) != "invalid_format" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// SPEC 12.8 items 5 and 6.
func TestLoginRateLimitOverHTTP(t *testing.T) {
	e := newEnv(t)
	bad := `{"secret":"` + strings.Repeat("A", 32) + `"}`
	for i := range 5 {
		w := e.do(req{method: "POST", path: "/api/auth/login", body: bad})
		if w.Code != 401 || errCode(t, w) != "invalid_secret" {
			t.Fatalf("attempt %d: %d %s", i+1, w.Code, w.Body)
		}
		var body struct {
			Error apiError `json:"error"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if body.Error.RemainingAttempts == nil || *body.Error.RemainingAttempts != 4-i {
			t.Fatalf("attempt %d remaining %v", i+1, body.Error.RemainingAttempts)
		}
	}
	w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"` + e.secret + `"}`})
	if w.Code != 429 || errCode(t, w) != "too_many_attempts" || w.Header().Get("Retry-After") == "" {
		t.Fatalf("6th: %d %s %v", w.Code, w.Body, w.Header())
	}
	if !strings.Contains(w.Body.String(), `"retryAfterSeconds":60`) {
		t.Fatalf("body %s", w.Body)
	}
	if w.Header().Get("Set-Cookie") != "" {
		t.Fatal("cookie set while locked")
	}
	// Still locked a bit later with the right secret.
	e.clock.Advance(30 * time.Second)
	if w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"` + e.secret + `"}`}); w.Code != 429 {
		t.Fatalf("lock lifted early: %d", w.Code)
	}
	e.clock.Advance(31 * time.Second)
	if w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"` + e.secret + `"}`}); w.Code != 204 {
		t.Fatalf("after lock: %d %s", w.Code, w.Body)
	}
}

// SPEC 12.8 item 7.
func TestBodyLimit(t *testing.T) {
	e := newEnv(t)
	tok := e.login()
	big := `{"secret":"` + strings.Repeat("a", 70<<10) + `"}`
	for _, r := range []req{
		{method: "POST", path: "/api/auth/login", body: big},
		{method: "POST", path: "/api/batches", body: big, cookie: tok},
	} {
		if w := e.do(r); w.Code != 413 || errCode(t, w) != "payload_too_large" {
			t.Errorf("%s: %d %s", r.path, w.Code, w.Body)
		}
	}
	// Chunked body without Content-Length is limited while reading.
	hr := httptest.NewRequest("POST", "/api/auth/login", io.MultiReader(strings.NewReader(big)))
	hr.ContentLength = -1
	hr.TransferEncoding = []string{"chunked"}
	hr.Header.Set("Origin", origin)
	hr.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, hr)
	if w.Code != 413 {
		t.Fatalf("chunked: %d %s", w.Code, w.Body)
	}
}

func TestLoginMeLogout(t *testing.T) {
	e := newEnv(t)
	if w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"short"}`}); w.Code != 400 || errCode(t, w) != "invalid_format" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"a","x":1}`}); w.Code != 400 || errCode(t, w) != "invalid_json" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "POST", path: "/api/auth/login", body: `{"secret":"a"} {}`}); w.Code != 400 || errCode(t, w) != "invalid_json" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	tok := e.login()
	w := e.do(req{method: "GET", path: "/api/auth/me", cookie: tok})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"authenticated":true`) || !strings.Contains(w.Body.String(), `"expiresAt":"2026-12-13T19:00:00Z"`) {
		t.Fatalf("me %d %s", w.Code, w.Body)
	}
	w = e.do(req{method: "POST", path: "/api/auth/logout", cookie: tok})
	if w.Code != 204 || !strings.Contains(w.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout %d %v", w.Code, w.Header())
	}
	if w := e.do(req{method: "GET", path: "/api/auth/me", cookie: tok}); w.Code != 401 {
		t.Fatalf("me after logout %d", w.Code)
	}
}

// SPEC 12.8 item 16.
func TestRotateInvalidatesSessionsOverHTTP(t *testing.T) {
	e := newEnv(t)
	tok := e.login()
	if _, err := e.srv.Auth.Rotate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if w := e.do(req{method: "GET", path: "/api/auth/me", cookie: tok}); w.Code != 401 {
		t.Fatalf("session survived rotate: %d", w.Code)
	}
}

func TestNotFoundAndMethodNotAllowed(t *testing.T) {
	e := newEnv(t)
	tok := e.login()
	if w := e.do(req{method: "GET", path: "/api/nope", cookie: tok}); w.Code != 404 || errCode(t, w) != "not_found" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "PUT", path: "/api/batches", body: "{}", cookie: tok}); w.Code != 405 || errCode(t, w) != "method_not_allowed" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "GET", path: "/api/batches/not-a-uuid", cookie: tok}); w.Code != 400 || errCode(t, w) != "invalid_id" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "GET", path: "/api/batches?limit=500", cookie: tok}); w.Code != 400 || errCode(t, w) != "invalid_limit" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	for _, before := range []string{"0", "-3", "x", "1.5"} {
		if w := e.do(req{method: "GET", path: "/api/batches?before=" + before, cookie: tok}); w.Code != 400 || errCode(t, w) != "invalid_before" {
			t.Fatalf("before=%s: %d %s", before, w.Code, w.Body)
		}
	}
	if w := e.do(req{method: "GET", path: "/api/batches/01933f6e-0000-7000-8000-000000000000", cookie: tok}); w.Code != 404 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestFullBatchFlowAndLogsHaveNoSecrets(t *testing.T) {
	e := newEnv(t)
	tok := e.login()
	ctx := context.Background()

	w := e.do(req{method: "POST", path: "/api/batches", cookie: tok, body: `{"priceKz":10000,"sizes":["L","M"],"description":"Veste","photoCount":2}`})
	if w.Code != 201 {
		t.Fatalf("create %d %s", w.Code, w.Body)
	}
	var created batches.Created
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	if created.StampLine1 != "Veste/ M e L" || len(created.Photos) != 2 || created.Photos[0].Upload.Fields["policy"] == "" {
		t.Fatalf("created %+v", created)
	}
	if w := e.do(req{method: "POST", path: "/api/batches", cookie: tok, body: `{"priceKz":0,"sizes":["M"],"photoCount":1}`}); w.Code != 400 || errCode(t, w) != "invalid_price" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}

	p1, p2 := created.Photos[0].ID, created.Photos[1].ID
	if w := e.do(req{method: "POST", path: "/api/photos/" + p1 + "/uploaded", cookie: tok}); w.Code != 409 || errCode(t, w) != "object_missing" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	jpg := testutil.JPEG(t, 600, 800, color.NRGBA{R: 220, G: 210, B: 200, A: 255})
	e.st.Put(batches.OriginalKey(created.ID, p1), jpg)
	if w := e.do(req{method: "POST", path: "/api/photos/" + p1 + "/uploaded", cookie: tok}); w.Code != 202 {
		t.Fatalf("uploaded %d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "POST", path: "/api/photos/" + p1 + "/uploaded", cookie: tok}); w.Code != 409 || errCode(t, w) != "invalid_state" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "POST", path: "/api/photos/" + p2 + "/upload-failed", cookie: tok}); w.Code != 204 {
		t.Fatalf("upload-failed %d %s", w.Code, w.Body)
	}
	w = e.do(req{method: "POST", path: "/api/photos/" + p2 + "/upload-slot", cookie: tok})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"url":"/s3/estudio"`) {
		t.Fatalf("slot %d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "GET", path: "/api/photos/" + p1 + "/stamped", cookie: tok}); w.Code != 404 || errCode(t, w) != "not_ready" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}

	// Process photo 1.
	proc := &jobs.Processor{DB: e.db, Storage: e.st, MaxBytes: 15 << 20, Layout: stamp.DefaultLayout(), Now: e.clock.Now, Log: testutil.Logger(e.logs)}
	pool := jobs.NewPool(e.db, proc, 1, testutil.Logger(e.logs))
	pool.Now = e.clock.Now
	pool.RunOnce()

	w = e.do(req{method: "GET", path: "/api/batches/" + created.ID, cookie: tok})
	var d batches.Detail
	_ = json.Unmarshal(w.Body.Bytes(), &d)
	if w.Code != 200 || d.Photos[0].Status != "stamped" || d.Photos[1].Status != "awaiting_upload" || d.Finished {
		t.Fatalf("detail %d %s", w.Code, w.Body)
	}
	w = e.do(req{method: "GET", path: "/api/photos/" + p1 + "/stamped", cookie: tok})
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/jpeg" || w.Header().Get("Cache-Control") != "private, max-age=3600" ||
		w.Header().Get("Content-Disposition") != `attachment; filename="nethstore-001-001.jpg"` || w.Body.Len() == 0 {
		t.Fatalf("stamped %d %v", w.Code, w.Header())
	}
	w = e.do(req{method: "GET", path: "/api/photos/" + p1 + "/thumb", cookie: tok})
	if w.Code != 200 || w.Header().Get("Content-Disposition") != "" || w.Body.Len() == 0 {
		t.Fatalf("thumb %d %v", w.Code, w.Header())
	}
	// Thumbnail removed by retention: falls back to the stamped image.
	_ = e.st.DeletePrefix(ctx, "thumbs/")
	if w := e.do(req{method: "GET", path: "/api/photos/" + p1 + "/thumb", cookie: tok}); w.Code != 200 {
		t.Fatalf("thumb fallback %d", w.Code)
	}
	if w := e.do(req{method: "POST", path: "/api/photos/" + p1 + "/retry", cookie: tok}); w.Code != 409 {
		t.Fatalf("retry stamped %d", w.Code)
	}
	_ = e.db.SetPhotoFailed(ctx, p1, "stamp", "processing_failed", e.clock.Now())
	if w := e.do(req{method: "POST", path: "/api/photos/" + p1 + "/retry", cookie: tok}); w.Code != 202 {
		t.Fatalf("retry %d %s", w.Code, w.Body)
	}

	w = e.do(req{method: "GET", path: "/api/batches?limit=5", cookie: tok})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"batches":[{`) || !strings.Contains(w.Body.String(), `"nextBefore":null`) ||
		!strings.Contains(w.Body.String(), `"coverPhotoId":`) {
		t.Fatalf("list %d %s", w.Code, w.Body)
	}
	if w := e.do(req{method: "GET", path: "/api/batches?before=1", cookie: tok}); w.Code != 200 || w.Body.String() != `{"batches":[],"nextBefore":null}`+"\n" {
		t.Fatalf("list before %d %q", w.Code, w.Body)
	}
	if w := e.do(req{method: "DELETE", path: "/api/batches/" + created.ID, cookie: tok}); w.Code != 204 {
		t.Fatalf("delete %d %s", w.Code, w.Body)
	}
	if len(e.st.Keys("")) != 0 {
		t.Fatalf("objects left %v", e.st.Keys(""))
	}

	// SPEC 12.8 item 15: neither the secret nor the session token appear in logs.
	logs := e.logs.String()
	if strings.Contains(logs, e.secret) || strings.Contains(logs, tok) {
		t.Fatal("logs leak the secret or the session token")
	}
	if strings.Contains(logs, created.Photos[0].Upload.Fields["policy"]) || strings.Contains(logs, "x-amz-signature") {
		t.Fatal("logs leak policy fields")
	}
	if !strings.Contains(logs, `"path":"/api/batches"`) {
		t.Fatal("request log missing")
	}
}

func TestTooManyOpenBatchesOverHTTP(t *testing.T) {
	e := newEnv(t)
	tok := e.login()
	for i := range 6 {
		w := e.do(req{method: "POST", path: "/api/batches", cookie: tok, body: `{"priceKz":100,"sizes":["M"],"photoCount":1}`})
		if i < 5 && w.Code != 201 {
			t.Fatalf("batch %d: %d", i, w.Code)
		}
		if i == 5 && (w.Code != 429 || errCode(t, w) != "too_many_open_batches") {
			t.Fatalf("6th: %d %s", w.Code, w.Body)
		}
	}
}

func TestClientIPFromProxyOnly(t *testing.T) {
	e := newEnv(t)
	e.srv.proxy = &proxyResolver{host: "localhost", ttl: time.Minute}
	hr := httptest.NewRequest("GET", "/api/health", nil)
	hr.RemoteAddr = "127.0.0.1:5555"
	hr.Header.Set("X-Forwarded-For", "6.6.6.6, 192.168.1.30")
	if ip := e.srv.clientIP(hr); ip != "192.168.1.30" {
		t.Fatalf("from proxy: %s", ip)
	}
	hr.RemoteAddr = "192.168.1.99:5555"
	if ip := e.srv.clientIP(hr); ip != "192.168.1.99" {
		t.Fatalf("spoofed XFF trusted: %s", ip)
	}
	hr.RemoteAddr = "127.0.0.1:5555"
	hr.Header.Set("X-Forwarded-For", "garbage")
	if ip := e.srv.clientIP(hr); ip != "127.0.0.1" {
		t.Fatalf("garbage XFF: %s", ip)
	}
}

func TestHTTPServerTimeouts(t *testing.T) {
	e := newEnv(t)
	s := e.srv.HTTPServer()
	if s.ReadHeaderTimeout != 5*time.Second || s.ReadTimeout != 15*time.Second || s.WriteTimeout != 60*time.Second ||
		s.IdleTimeout != 120*time.Second || s.MaxHeaderBytes != 16<<10 {
		t.Fatalf("timeouts %+v", s)
	}
}

func TestPanicRecovered(t *testing.T) {
	e := newEnv(t)
	h := e.srv.observe(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/x", nil))
	if w.Code != 500 || errCode(t, w) != "internal" || !strings.Contains(e.logs.String(), "boom") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
