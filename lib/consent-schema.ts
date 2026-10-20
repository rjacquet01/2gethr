import { sql } from "./db"

// Additive schema for age confirmation, terms acceptance and parental consent
// (scripts/add-coppa-consent.sql does the same up front). Only needs the
// database, so anything can call it.

let ensured: Promise<void> | null = null

export function ensureConsentSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed_at TIMESTAMPTZ`
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT`
      // No foreign keys: the record of consent (and of its withdrawal) is kept
      // after the child's data is deleted.
      await sql`
        CREATE TABLE IF NOT EXISTS parental_consents (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          parent_user_id TEXT NOT NULL,
          child_member_id TEXT NOT NULL,
          child_user_id TEXT,
          scope TEXT NOT NULL,
          consent_text_version TEXT NOT NULL,
          consent_text TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          withdrawn_at TIMESTAMPTZ,
          withdrawn_by TEXT
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_parental_consents_child ON parental_consents(child_member_id)`
      await sql`CREATE INDEX IF NOT EXISTS idx_parental_consents_parent ON parental_consents(parent_user_id)`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

