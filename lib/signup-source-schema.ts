import { ddl } from "./schema-snapshot"

// Columns for lib/signup-source.ts (server only; that file is also used in the browser).
let ensured: Promise<void> | null = null
export function ensureSignupSourceColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT`
      await ddl`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_campaign TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
