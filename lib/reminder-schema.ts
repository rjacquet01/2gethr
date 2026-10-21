import { sql } from "./db"
import { ddl } from "./schema-snapshot"

// Reminders can now be set for a child's profile (kids often have no login of
// their own). This adds reminders.child_profile_id idempotently the first time
// any reminder code runs, same pattern as lib/place-schema.ts.
let ensured: Promise<void> | null = null

export function ensureReminderChildColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS child_profile_id TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
