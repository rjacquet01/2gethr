import crypto from "crypto"
import { sql } from "./db"
import { ddl } from "./schema-snapshot"

// Long-lived, revocable credentials that let the native Android app report
// location from a background service (where the web session cookies are not
// available). A token is scoped: it can only be used to POST /api/location for
// the one family member it was issued to. Only a SHA-256 hash is stored.

let ensured = false
async function ensureTable() {
  if (ensured) return
  await ddl`
    CREATE TABLE IF NOT EXISTS location_device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_member_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `
  await ddl`CREATE INDEX IF NOT EXISTS idx_location_device_tokens_user ON location_device_tokens(user_id, family_member_id)`
  await ddl`
    ALTER TABLE location_device_tokens
      ADD COLUMN IF NOT EXISTS claim_hash TEXT,
      ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ
  `
  ensured = true
}

// The togethr-bg:// link that hands a token to the app can be opened by any
// page, so someone could send a link carrying a token from their own account.
// App 1.2.6+ claims the token first, which makes it unusable until the website
// confirms it, signed in on that phone as the token's owner. Tokens never
// claimed (older apps) work as before.
export const CLAIM_MINUTES = 15

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex")

export async function issueDeviceToken(userId: string, memberId: string, familyId: string): Promise<string> {
  await ensureTable()
  // One active token per member: re-enabling replaces the old one.
  await sql`
    UPDATE location_device_tokens SET revoked_at = NOW()
    WHERE user_id = ${userId} AND family_member_id = ${memberId} AND revoked_at IS NULL
  `
  const token = `tgd_${crypto.randomBytes(32).toString("hex")}`
  await sql`
    INSERT INTO location_device_tokens (id, user_id, family_member_id, family_id, token_hash)
    VALUES (${`ldt_${crypto.randomBytes(8).toString("hex")}`}, ${userId}, ${memberId}, ${familyId}, ${hash(token)})
  `
  return token
}

export interface DeviceTokenInfo {
  userId: string
  memberId: string
  familyId: string
}

export async function verifyDeviceToken(token: string): Promise<DeviceTokenInfo | null> {
  if (!token.startsWith("tgd_")) return null
  await ensureTable()
  const rows = await sql`
    UPDATE location_device_tokens
    SET last_used_at = NOW()
    WHERE token_hash = ${hash(token)} AND revoked_at IS NULL
      AND (claimed_at IS NULL OR confirmed_at IS NOT NULL)
    RETURNING user_id, family_member_id, family_id
  `
  if (rows.length === 0) return null
  return { userId: rows[0].user_id, memberId: rows[0].family_member_id, familyId: rows[0].family_id }
}

/**
 * The app received this token: lock it until confirmed. Returns the one-time code for the confirm page.
 * Once per token: the phone that claims it first holds the only code, so no one (the
 * token's owner included) can re-claim it to replace that code.
 */
export async function claimDeviceToken(token: string): Promise<(DeviceTokenInfo & { code: string }) | null> {
  if (!token.startsWith("tgd_")) return null
  await ensureTable()
  const code = crypto.randomBytes(24).toString("hex")
  const rows = await sql`
    UPDATE location_device_tokens
    SET claim_hash = ${hash(code)}, claimed_at = NOW()
    WHERE token_hash = ${hash(token)} AND revoked_at IS NULL AND claimed_at IS NULL AND confirmed_at IS NULL
    RETURNING user_id, family_member_id, family_id
  `
  if (rows.length === 0) return null
  return { userId: rows[0].user_id, memberId: rows[0].family_member_id, familyId: rows[0].family_id, code }
}

export type ConfirmResult =
  | { ok: true; info: DeviceTokenInfo }
  | { ok: false; reason: "expired" | "other_account" }

/**
 * The confirm page, signed in on the phone, vouches for the claimed token.
 * A token from another account is revoked so it can never be used.
 */
export async function confirmDeviceToken(code: string, userId: string): Promise<ConfirmResult> {
  await ensureTable()
  const rows = await sql`
    UPDATE location_device_tokens
    SET confirmed_at = NOW(), claim_hash = NULL
    WHERE claim_hash = ${hash(code)} AND user_id = ${userId} AND revoked_at IS NULL
      AND confirmed_at IS NULL AND claimed_at > NOW() - make_interval(mins => ${CLAIM_MINUTES})
    RETURNING user_id, family_member_id, family_id
  `
  if (rows.length > 0) {
    return { ok: true, info: { userId: rows[0].user_id, memberId: rows[0].family_member_id, familyId: rows[0].family_id } }
  }
  const other = await sql`
    UPDATE location_device_tokens
    SET revoked_at = NOW(), claim_hash = NULL
    WHERE claim_hash = ${hash(code)} AND user_id <> ${userId} AND revoked_at IS NULL
    RETURNING id
  `
  return { ok: false, reason: other.length > 0 ? "other_account" : "expired" }
}

export async function revokeDeviceTokens(userId: string, memberId: string): Promise<void> {
  await ensureTable()
  await sql`
    UPDATE location_device_tokens SET revoked_at = NOW()
    WHERE user_id = ${userId} AND family_member_id = ${memberId} AND revoked_at IS NULL
  `
}

export async function getDeviceTokenStatus(userId: string, memberId: string) {
  await ensureTable()
  const rows = await sql`
    SELECT created_at, last_used_at FROM location_device_tokens
    WHERE user_id = ${userId} AND family_member_id = ${memberId} AND revoked_at IS NULL
      AND (claimed_at IS NULL OR confirmed_at IS NOT NULL)
    ORDER BY created_at DESC LIMIT 1
  `
  if (rows.length === 0) return { active: false, createdAt: null, lastSeenAt: null }
  return { active: true, createdAt: rows[0].created_at, lastSeenAt: rows[0].last_used_at }
}

export async function revokeByToken(token: string): Promise<boolean> {
  await ensureTable()
  const rows = await sql`
    UPDATE location_device_tokens SET revoked_at = NOW()
    WHERE token_hash = ${hash(token)} AND revoked_at IS NULL
    RETURNING id
  `
  return rows.length > 0
}
