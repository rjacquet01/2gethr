-- Age confirmation, terms acceptance and parental consent records.
-- Additive only and safe to re-run. lib/parental-consent.ts ensureConsentSchema()
-- applies the same statements lazily.

ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;

-- No foreign keys on purpose: the record of consent (and of its withdrawal)
-- is kept after the child's data is deleted.
CREATE TABLE IF NOT EXISTS parental_consents (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  parent_user_id TEXT NOT NULL,
  child_member_id TEXT NOT NULL,
  child_user_id TEXT,
  scope TEXT NOT NULL,                 -- CHILD_PROFILE | CHILD_ACCOUNT
  consent_text_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,          -- the exact text the parent saw
  ip_address TEXT,
  user_agent TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_parental_consents_child ON parental_consents(child_member_id);
CREATE INDEX IF NOT EXISTS idx_parental_consents_parent ON parental_consents(parent_user_id);
