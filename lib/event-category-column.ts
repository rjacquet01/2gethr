import { sql } from "./db"
import { ddl } from "./schema-snapshot"

// Events historically had no category column, so the category chosen on the
// event form was never saved. Add it (idempotent) the first time any events
// route runs, mirroring the lazy-migration pattern used by device tokens.
let ensured: Promise<void> | null = null

export function ensureEventCategoryColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
