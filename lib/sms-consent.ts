import { sql } from "./db"
import { ddl } from "./schema-snapshot"

// Consent to receive texts (needed for Twilio 10DLC and TCPA). A user is
// only ever texted after turning text messages on next to this wording;
// users.sms_consent_at / sms_consent_text record when and to what. Turning
// SMS off (Settings or replying STOP) keeps the record but stops sending.
// Changing the phone number clears it: the consent was for that number.

import { SMS_CONSENT_TEXT } from "./sms-consent-text"
export { SMS_CONSENT_TEXT }

let ensured: Promise<void> | null = null

export function ensureSmsConsentSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ`
      await ddl`ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_text TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

/**
 * E.164 ("+16175550123") from the shapes numbers are stored in
 * ("6175550123", "16175550123", "(617) 555-0123", "+16175550123").
 * A bare 10-digit number is taken as US/Canada.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  if (!digits) return null
  if (raw.trim().startsWith("+")) return `+${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return `+1${digits}`
}

// Candidates share the last 10 digits; the exact E.164 match is made here.
async function usersWithNumber(phone: string): Promise<{ id: string; phone: string; sms_consent_at: string | null }[]> {
  const e164 = toE164(phone)
  if (!e164) return []
  await ensureSmsConsentSchema()
  const last10 = e164.replace(/\D/g, "").slice(-10)
  const rows = (await sql`
    SELECT id, phone, sms_consent_at FROM users
    WHERE phone IS NOT NULL AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${last10}
  `) as { id: string; phone: string; sms_consent_at: string | null }[]
  return rows.filter((r) => toE164(r.phone) === e164)
}

/** Whether someone with this number has agreed to texts. */
export async function hasSmsConsent(phone: string): Promise<boolean> {
  return (await usersWithNumber(phone)).some((r) => r.sms_consent_at != null)
}

/** Record consent with the wording the user saw (always the server's copy). */
export async function recordSmsConsent(userId: string): Promise<void> {
  await ensureSmsConsentSchema()
  await sql`
    UPDATE users SET sms_consent_at = NOW(), sms_consent_text = ${SMS_CONSENT_TEXT}
    WHERE id = ${userId}
  `
}

export async function getSmsConsent(userId: string): Promise<{ consentedAt: string | null }> {
  await ensureSmsConsentSchema()
  const rows = await sql`SELECT sms_consent_at FROM users WHERE id = ${userId}`
  return { consentedAt: (rows[0]?.sms_consent_at as string | null) ?? null }
}

/** Before saving a new number: a different number needs consent again. Returns true if cleared. */
export async function clearSmsConsentIfNumberChanges(userId: string, newPhone: string | null | undefined): Promise<boolean> {
  await ensureSmsConsentSchema()
  const rows = await sql`SELECT phone, sms_consent_at FROM users WHERE id = ${userId}`
  const before = rows[0]
  if (!before?.sms_consent_at || toE164(before.phone as string | null) === toE164(newPhone)) return false
  await sql`UPDATE users SET sms_consent_at = NULL, sms_consent_text = NULL WHERE id = ${userId}`
  return true
}

/** Reply STOP: turn texts off for everyone with this number. Returns how many accounts. */
export async function optOutNumber(phone: string): Promise<number> {
  const ids = (await usersWithNumber(phone)).map((r) => r.id)
  for (const id of ids) {
    await sql`
      INSERT INTO reminder_settings (id, user_id, email_enabled, push_enabled, sms_enabled, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${id}, true, true, false, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET sms_enabled = false, updated_at = NOW()
    `
  }
  return ids.length
}

/**
 * Text bodies: start with "Togethr:", no curly quotes, dashes or emoji (any
 * of them makes a text Unicode and cuts a segment from 160 to 70 characters),
 * and one segment (160) unless `keepWhole` (a safety alert with a map link).
 */
export function formatSmsBody(body: string, opts: { keepWhole?: boolean } = {}): string {
  let s = body
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!s.startsWith("Togethr:")) s = `Togethr: ${s}`
  if (!opts.keepWhole && s.length > 160) s = s.slice(0, 157).trimEnd() + "..."
  return s
}
