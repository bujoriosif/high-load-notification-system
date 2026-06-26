export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  follower_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  type         TEXT NOT NULL,
  priority     TEXT NOT NULL,
  actor_id     TEXT,
  subject_id   TEXT,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER,
  dedup_key    TEXT NOT NULL,
  agg_count    INTEGER NOT NULL DEFAULT 1,
  agg_actors   TEXT,
  UNIQUE (recipient_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_notif_feed ON notifications(recipient_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS celebrity_posts (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_celeb_author ON celebrity_posts(author_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS pull_read_watermark (
  user_id   TEXT PRIMARY KEY,
  watermark INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY
);
`;
