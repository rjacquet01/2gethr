import { sql } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encryption'
import { generateTotpSecret, buildOtpAuthUrl, verifyTotp, generateBackupCodes, hashBackupCode } from '@/lib/totp'

// Two-step sign-in for the admin panel (authenticator app codes). Optional to
// set up, enforced at login once an admin turns it on (loginAdmin). Secrets
// are stored encrypted; backup codes only as hashes.

const ISSUER = 'Togethr Admin'
let ensured: Promise<void> | null = null

function ensureColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT`
      await sql`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

export async function adminMfaStatus(adminId: string): Promise<{ enabled: boolean; backupCodesLeft: number }> {
  await ensureColumns()
  const rows = await sql`SELECT mfa_enabled, mfa_backup_codes FROM admin_users WHERE id = ${adminId}`
  const r = rows[0]
  return { enabled: !!r?.mfa_enabled, backupCodesLeft: Array.isArray(r?.mfa_backup_codes) ? r.mfa_backup_codes.length : 0 }
}

/** Start setup: a new pending secret (replaced if called again before confirming). */
export async function startAdminMfa(adminId: string, email: string): Promise<{ secret: string; otpAuthUrl: string } | { error: string }> {
  await ensureColumns()
  const rows = await sql`SELECT mfa_enabled FROM admin_users WHERE id = ${adminId}`
  if (rows[0]?.mfa_enabled) return { error: 'Two-step sign-in is already on. Turn it off first to set up a new device.' }
  const secret = generateTotpSecret()
  await sql`UPDATE admin_users SET mfa_pending_secret_enc = ${encrypt(secret)} WHERE id = ${adminId}`
  return { secret, otpAuthUrl: buildOtpAuthUrl(secret, `${ISSUER}:${email}`, ISSUER) }
}

/** Confirm setup with a code from the app; returns the one-time backup codes. */
export async function confirmAdminMfa(adminId: string, code: string): Promise<{ backupCodes: string[] } | { error: string }> {
  await ensureColumns()
  const rows = await sql`SELECT mfa_pending_secret_enc FROM admin_users WHERE id = ${adminId}`
  const pending = rows[0]?.mfa_pending_secret_enc as string | null
  if (!pending) return { error: 'Start setup first.' }
  if (!verifyTotp(decrypt(pending), code.trim())) return { error: 'That code is not right. Try the current one.' }
  const backupCodes = generateBackupCodes()
  await sql`
    UPDATE admin_users
    SET mfa_secret_enc = ${pending}, mfa_pending_secret_enc = NULL, mfa_enabled = true,
        mfa_backup_codes = ${backupCodes.map(hashBackupCode)}::text[], updated_at = NOW()
    WHERE id = ${adminId}
  `
  return { backupCodes }
}

export async function disableAdminMfa(adminId: string): Promise<void> {
  await ensureColumns()
  await sql`
    UPDATE admin_users
    SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL,
        mfa_backup_codes = NULL, updated_at = NOW()
    WHERE id = ${adminId}
  `
}

/** Login step: a current authenticator code, or an unused backup code (then spent). */
export async function verifyAdminMfaCode(adminId: string, code: string): Promise<boolean> {
  await ensureColumns()
  const rows = await sql`SELECT mfa_secret_enc, mfa_backup_codes FROM admin_users WHERE id = ${adminId}`
  const r = rows[0]
  if (!r?.mfa_secret_enc) return false
  const clean = code.trim()
  if (/^\d{6}$/.test(clean)) return verifyTotp(decrypt(r.mfa_secret_enc as string), clean)
  const codes: string[] = Array.isArray(r.mfa_backup_codes) ? r.mfa_backup_codes : []
  const h = hashBackupCode(clean)
  if (!codes.includes(h)) return false
  await sql`UPDATE admin_users SET mfa_backup_codes = array_remove(mfa_backup_codes, ${h}) WHERE id = ${adminId}`
  return true
}
