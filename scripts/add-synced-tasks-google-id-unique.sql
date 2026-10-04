-- Add a unique constraint on (connection_id, google_task_id) to synced_tasks.
--
-- This is required for the Google Tasks pull-sync code's atomic claim:
--   INSERT INTO synced_tasks (...)
--   ON CONFLICT (connection_id, google_task_id) DO NOTHING
--   RETURNING id
-- to work at all -- Postgres needs a unique index/constraint matching the
-- ON CONFLICT target columns, or the INSERT raises
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- The existing UNIQUE(connection_id, familyhub_task_id) constraint only
-- protects the push direction (one Togethr task -> one Google task); this
-- adds the matching protection for the pull direction (one Google task ->
-- one Togethr task), so a Google Tasks import can never create two local
-- tasks mapped to the same Google task.
CREATE UNIQUE INDEX IF NOT EXISTS idx_synced_tasks_connection_google_unique
  ON synced_tasks(connection_id, google_task_id);
