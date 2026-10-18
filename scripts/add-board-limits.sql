-- Family board pin limits: roll-off, Keep up, and event flyers that come
-- down after their date. Same statements as ensureBoardLimitColumns() in
-- lib/board-limits.ts, which also adds them lazily. Only adds nullable or
-- defaulted columns: every existing post stays visible.
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS taken_down_at TIMESTAMPTZ;
-- 'roll_off' (made room) | 'event_over' (past its date) | 'manual'
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS taken_down_reason TEXT;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS keep_up BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_family_posts_taken_down ON family_posts(family_id, taken_down_at);
