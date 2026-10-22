import { ddl } from "./schema-snapshot"

// Reminders can now be set for a child's profile (kids often have no login of
// their own). This adds reminders.child_profile_id idempotently the first time
// any reminder code runs, same pattern as lib/place-schema.ts.
let ensured: Promise<void> | null = null

export function ensureReminderChildColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS child_profile_id TEXT`
      // A child's "Ask a parent" reminder: 'PENDING_APPROVAL' until a parent
      // approves ('APPROVED') or declines ('DECLINED'). NULL = no approval asked.
      await ddl`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS approval_status TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
