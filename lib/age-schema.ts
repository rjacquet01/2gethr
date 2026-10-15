import { sql } from "./db"

// Lazy idempotent schema for child birthdates and the 18th-birthday prompt
// (scripts/run-age-transitions-migration.mjs adds the same columns up front).
let ensured: Promise<void> | null = null
export function ensureAgeColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE`
      await sql`ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS turning18_notice_sent_at TIMESTAMPTZ`
      await sql`ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS adult_prompt_last_sent_at TIMESTAMPTZ`
      await sql`ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS adult_prompt_count INTEGER DEFAULT 0`
      await sql`ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS adult_prompt_snoozed_until TIMESTAMPTZ`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
