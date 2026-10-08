import { sql } from "./db"

// Per-member avatar customization (color + emoji). Added lazily because the
// production database is not migrated by hand.
let ensured: Promise<void> | null = null

export function ensureMemberAppearanceColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE family_members ADD COLUMN IF NOT EXISTS color TEXT`
      await sql`ALTER TABLE family_members ADD COLUMN IF NOT EXISTS emoji TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
