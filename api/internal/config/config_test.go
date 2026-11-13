package config

import (
	"strings"
	"testing"
	"time"
)

func env(over map[string]string) Getenv {
	base := map[string]string{
		"APP_ORIGIN": "https://192.168.1.50", "DATABASE_PATH": "/data/estudio.db", "S3_ENDPOINT": "http://garage:3900",
		"S3_ACCESS_KEY_ID": "GK1", "S3_SECRET_ACCESS_KEY": "s",
	}
	for k, v := range over {
		base[k] = v
	}
	return func(k string) string { return base[k] }
}

func TestDefaults(t *testing.T) {
	c, err := LoadFrom(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.DeployMode != "lan" || !c.LoginGlobalLockout || c.Workers != 2 || c.MaxUploadBytes != 15<<20 || c.SessionTTL != 720*time.Hour ||
		c.UploadPath != "/s3/estudio" || c.ListenAddr != ":8080" || c.S3Region != "garage" || c.S3Bucket != "estudio" {
		t.Fatalf("%+v", c)
	}
	c, _ = LoadFrom(env(map[string]string{"DEPLOY_MODE": "public", "APP_ORIGIN": "https://loja.example.com/"}))
	if c.LoginGlobalLockout || c.AppOrigin != "https://loja.example.com" {
		t.Fatalf("public defaults %+v", c)
	}
	c, _ = LoadFrom(env(map[string]string{"DEPLOY_MODE": "public", "LOGIN_GLOBAL_LOCKOUT": "true"}))
	if !c.LoginGlobalLockout {
		t.Fatal("explicit lockout ignored")
	}
	c, _ = LoadFrom(env(map[string]string{"LOGIN_GLOBAL_LOCKOUT": "0"}))
	if c.LoginGlobalLockout {
		t.Fatal("explicit false ignored")
	}
}

func TestInvalid(t *testing.T) {
	cases := map[string]map[string]string{
		"APP_ORIGIN":             {"APP_ORIGIN": "http://192.168.1.50"},
		"APP_ORIGIN path":        {"APP_ORIGIN": "https://x/app"},
		"DATABASE_PATH":          {"DATABASE_PATH": ""},
		"DEPLOY_MODE":            {"DEPLOY_MODE": "cloud"},
		"WORKERS":                {"WORKERS": "0"},
		"MAX_UPLOAD_BYTES":       {"MAX_UPLOAD_BYTES": "abc"},
		"SESSION_TTL":            {"SESSION_TTL": "forever"},
		"S3_ENDPOINT":            {"S3_ENDPOINT": "garage:3900"},
		"UPLOAD_PATH":            {"UPLOAD_PATH": "s3/estudio"},
		"LOGIN_GLOBAL_LOCKOUT":   {"LOGIN_GLOBAL_LOCKOUT": "maybe"},
		"RETENTION_BATCHES_DAYS": {"RETENTION_BATCHES_DAYS": "10"},
		"LOG_LEVEL":              {"LOG_LEVEL": "loud"},
		"MAX_PHOTOS_PER_BATCH":   {"MAX_PHOTOS_PER_BATCH": "51"},
		"S3_SECRET_ACCESS_KEY":   {"S3_SECRET_ACCESS_KEY": ""},
	}
	for want, over := range cases {
		_, err := LoadFrom(env(over))
		if err == nil || !strings.Contains(err.Error(), strings.Fields(want)[0]) {
			t.Errorf("%s: err = %v", want, err)
		}
	}
	if _, err := LoadForCLI(func(string) string { return "" }); err == nil {
		t.Fatal("CLI without DATABASE_PATH")
	}
	if p, err := LoadForCLI(func(string) string { return "/x.db" }); err != nil || p != "/x.db" {
		t.Fatal("CLI path")
	}
}
