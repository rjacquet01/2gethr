import { sql } from "./db"

// tasks.notify_channels / events.notify_channels were added by
// scripts/add-notify-channels-to-tasks-and-events.sql, which was never run on
// production, so creating an event (and a task with a channel picked) failed
// on the INSERT. Add them idempotently the first time either route runs.
let ensured: Promise<void> | null = null

export function ensureTaskEventNotifyChannelsColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notify_channels TEXT[]`
      await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS notify_channels TEXT[]`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
