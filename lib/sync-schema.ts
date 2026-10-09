import { sql } from "./db"

// The calendar/task sync tables and columns were defined in scripts/*.sql that
// were never run by hand against production, so every route that touches them
// has to be able to create what it needs. Idempotent and memoized, same
// pattern as lib/notify-channels-schema.ts.
let ensured: Promise<void> | null = null

export function ensureSyncSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS sync_tasks BOOLEAN DEFAULT false`
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS google_tasklist_id TEXT`
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS apple_caldav_server TEXT`
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS apple_task_calendar_url TEXT`
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS ical_token TEXT`
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS task_sync_interval_minutes INTEGER NOT NULL DEFAULT 30`
      // Which kinds of items the subscription link carries.
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS feed_include_tasks BOOLEAN NOT NULL DEFAULT true`
      await sql`ALTER TABLE calendar_sync_connections ADD COLUMN IF NOT EXISTS feed_include_reminders BOOLEAN NOT NULL DEFAULT true`

      await sql`
        CREATE TABLE IF NOT EXISTS synced_tasks (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          connection_id TEXT NOT NULL,
          familyhub_task_id TEXT NOT NULL,
          google_task_id TEXT,
          google_tasklist_id TEXT,
          apple_reminder_uid TEXT,
          last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(connection_id, familyhub_task_id)
        )
      `
      await sql`ALTER TABLE synced_tasks ADD COLUMN IF NOT EXISTS apple_reminder_uid TEXT`
      await sql`ALTER TABLE synced_tasks ALTER COLUMN google_task_id DROP NOT NULL`
      await sql`ALTER TABLE synced_tasks ALTER COLUMN google_tasklist_id DROP NOT NULL`
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_synced_tasks_connection_apple_unique
        ON synced_tasks(connection_id, apple_reminder_uid) WHERE apple_reminder_uid IS NOT NULL
      `

      // Togethr reminders <-> Apple Reminders (VTODO with an alarm).
      await sql`
        CREATE TABLE IF NOT EXISTS synced_reminders (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          connection_id TEXT NOT NULL,
          reminder_id TEXT NOT NULL,
          apple_uid TEXT NOT NULL,
          last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(connection_id, reminder_id),
          UNIQUE(connection_id, apple_uid)
        )
      `
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
