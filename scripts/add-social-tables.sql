-- Event comments, the family board, and push coalescing. Text only.
CREATE TABLE IF NOT EXISTS event_comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_event_comments_event ON event_comments(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_comments_user ON event_comments(user_id, created_at);
CREATE TABLE IF NOT EXISTS family_posts (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_family_posts_family ON family_posts(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_family_posts_user ON family_posts(user_id, created_at);
CREATE TABLE IF NOT EXISTS family_post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_family_post_comments_post ON family_post_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_family_post_comments_user ON family_post_comments(user_id, created_at);
CREATE TABLE IF NOT EXISTS social_push_log (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  last_push_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, scope)
);
CREATE INDEX IF NOT EXISTS idx_social_push_log_time ON social_push_log(last_push_at);
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS board_last_seen_at TIMESTAMPTZ;
