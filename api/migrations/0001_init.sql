CREATE TABLE auth_secret (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  hash        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash   BLOB PRIMARY KEY,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ip       TEXT NOT NULL,
  at       TEXT NOT NULL,
  success  INTEGER NOT NULL CHECK (success IN (0, 1))
);
CREATE INDEX login_attempts_ip_at ON login_attempts (ip, at);
CREATE INDEX login_attempts_at ON login_attempts (at);

CREATE TABLE batches (
  id           TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL UNIQUE,
  price_kz     INTEGER NOT NULL CHECK (price_kz BETWEEN 1 AND 9999999),
  sizes        TEXT NOT NULL,
  description  TEXT,
  stamp_line1  TEXT NOT NULL,
  stamp_line2  TEXT NOT NULL,
  photo_count  INTEGER NOT NULL CHECK (photo_count BETWEEN 1 AND 50),
  created_at   TEXT NOT NULL
);

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('awaiting_upload', 'uploaded', 'prepared', 'stamped', 'failed')),
  failed_step   TEXT CHECK (failed_step IN ('upload', 'prepare', 'stamp')),
  error_code    TEXT,
  original_key  TEXT NOT NULL,
  thumb_key     TEXT,
  stamped_key   TEXT,
  bytes         INTEGER,
  width         INTEGER,
  height        INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (batch_id, position)
);
CREATE INDEX photos_batch ON photos (batch_id);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id    TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('process')),
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  run_after   TEXT NOT NULL,
  locked_at   TEXT,
  last_error  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX jobs_ready ON jobs (status, run_after);
CREATE INDEX jobs_photo ON jobs (photo_id);
