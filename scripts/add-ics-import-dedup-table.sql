-- Dedup tracking for the one-off .ics file/URL importer
-- (app/api/calendar-sync/ical/import/route.ts).
--
-- The importer used to decide "already imported?" with a plain SELECT
-- before INSERTing - a check-then-act race, same shape as the bug fixed in
-- calendar-sync-core.ts for Google/Apple sync. A fast double-click of
-- "Import" (or submitting the same file twice in quick succession) could
-- pass the check twice before either INSERT landed, creating duplicates -
-- contradicting the UI's own promise that "re-importing the same file
-- won't create duplicates."
--
-- This table exists purely as an atomic claim-ticket: one row per
-- (family, item type, title, occurs-at) the importer has ever created,
-- guarded by a UNIQUE constraint so the INSERT itself is the atomic check.
-- It's a separate table (not a constraint on events/tasks directly) so it
-- can't ever block or interfere with the normal "create event"/"create
-- task" flows, which are allowed to have two entries sharing a title and
-- time on purpose.
CREATE TABLE IF NOT EXISTS ics_import_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('event', 'task')),
  title TEXT NOT NULL,
  occurs_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (family_id, item_type, title, occurs_at)
);

CREATE INDEX IF NOT EXISTS idx_ics_import_records_family ON ics_import_records(family_id);
