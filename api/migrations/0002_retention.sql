-- Marks when the janitor removed a batch's originals and thumbnails, so the
-- daily run does not list the same prefixes again.
ALTER TABLE batches ADD COLUMN originals_purged_at TEXT;
CREATE INDEX batches_created_at ON batches (created_at);
CREATE INDEX photos_status_created ON photos (status, created_at);
