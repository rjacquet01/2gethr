-- Photo flyers on the family board. A post with flyer_full_path set is a
-- flyer; its two private Vercel Blob files (full + thumbnail) are deleted
-- with the post. Same statements as ensureBoardFlyerColumns() in
-- lib/board-flyers.ts, which also adds them lazily.
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_full_path TEXT;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_full_url TEXT;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_thumb_path TEXT;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_thumb_url TEXT;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_width INTEGER;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_height INTEGER;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_uploaded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_family_posts_flyers ON family_posts(family_id)
  WHERE flyer_full_path IS NOT NULL AND deleted_at IS NULL;
