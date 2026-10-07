import crypto from "crypto"
import { sql } from "./db"

// Long-lived, revocable credentials that let the native Android app report
// location from a background service (where the web session cookies are not
// available). A token is scoped: it can only be used to POST /api/location for
// the one family member it was issued to. Only a SHA-256 hash is stored.

let ensured = false
async function ensureTable() {
  if (ensured) return
  await sql`
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
  await sql`CREATE INDEX IF NOT EXISTS idx_location_device_tokens_user ON location_device_tokens(user_id, family_member_id)`
  ensured = true
}

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
    RETURNING user_id, family_member_id, family_id
  `
  if (rows.length === 0) return null
  return { userId: rows[0].user_id, memberId: rows[0].family_member_id, familyId: rows[0].family_id }
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
