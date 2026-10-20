/**
 * Two-factor authentication (TOTP) service for regular users.
 *
 * Requires scripts/add-two-factor-auth.sql to have been run against the
 * database (adds two_factor_enabled/two_factor_secret/
 * two_factor_pending_secret/two_factor_backup_codes to `users`).
 */

import { sql } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encryption'
import {
  generateTotpSecret,
  buildOtpAuthUrl,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
} from '@/lib/totp'

const ISSUER = 'Togethr'

export interface TwoFactorSetupResult {
  secret: string
  otpAuthUrl: string
}

/**
 * Start (or restart) enrollment: generates a fresh secret, stores it
 * encrypted as "pending" (not yet active — 2FA isn't required at login
 * until confirmEnrollment() succeeds), and returns everything the
 * settings-page UI needs to render a QR code plus a manual-entry fallback.
 */
export async function startEnrollment(userId: string, userEmail: string): Promise<TwoFactorSetupResult> {
  const secret = generateTotpSecret()
  const otpAuthUrl = buildOtpAuthUrl(secret, `${ISSUER}:${userEmail}`, ISSUER)

  await sql`
    UPDATE users
    SET two_factor_pending_secret = ${encrypt(secret)}
    WHERE id = ${userId}
  `

  // No QR image from the server: rendering it through a third-party image
  // service put the TOTP secret in that service's logs. The client draws the
  // QR in the browser (components/totp-qr.tsx) and also offers the
  // otpauth:// link and the manual-entry secret.
  return { secret, otpAuthUrl }
}

/**
 * Confirm enrollment with a code from the user's authenticator app.
 * On success, promotes the pending secret to active, turns 2FA on, and
 * returns a fresh set of plaintext backup codes (shown to the user exactly
 * once — only their hashes are persisted).
 */
export async function confirmEnrollment(
  userId: string,
  code: string
): Promise<{ success: true; backupCodes: string[] } | { success: false; error: string }> {
  const rows = await sql`SELECT two_factor_pending_secret FROM users WHERE id = ${userId}`
  if (rows.length === 0 || !rows[0].two_factor_pending_secret) {
    return { success: false, error: 'No pending 2FA setup found. Please restart enrollment.' }
  }

  const secret = decrypt(rows[0].two_factor_pending_secret)
  if (!verifyTotp(secret, code)) {
    return { success: false, error: 'Invalid code. Check your authenticator app and try again.' }
  }

  const backupCodes = generateBackupCodes(10)
  const hashedCodes = backupCodes.map(hashBackupCode)

  await sql`
    UPDATE users
    SET two_factor_enabled = true,
        two_factor_secret = ${encrypt(secret)},
        two_factor_pending_secret = NULL,
        two_factor_backup_codes = ${hashedCodes},
        updated_at = NOW()
    WHERE id = ${userId}
  `

  return { success: true, backupCodes }
}

/** Turn 2FA off and clear all stored secrets/backup codes. */
export async function disableTwoFactor(userId: string): Promise<void> {
  await sql`
    UPDATE users
    SET two_factor_enabled = false,
        two_factor_secret = NULL,
        two_factor_pending_secret = NULL,
        two_factor_backup_codes = '{}',
        updated_at = NOW()
    WHERE id = ${userId}
  `
}

/**
 * Verify a login-time 2FA submission, accepting either a live TOTP code or
 * an unused backup code (which is consumed on use). Returns false for a
 * user who doesn't have 2FA enabled at all.
 */
export async function verifyLoginChallenge(userId: string, code: string): Promise<boolean> {
  const rows = await sql`
    SELECT two_factor_enabled, two_factor_secret, two_factor_backup_codes
    FROM users WHERE id = ${userId}
  `
  if (rows.length === 0 || !rows[0].two_factor_enabled || !rows[0].two_factor_secret) {
    return false
  }

  const secret = decrypt(rows[0].two_factor_secret)
  if (verifyTotp(secret, code)) {
    return true
  }

  // Fall back to backup codes.
  const backupHashes: string[] = rows[0].two_factor_backup_codes || []
  const candidateHash = hashBackupCode(code)
  if (backupHashes.includes(candidateHash)) {
    const remaining = backupHashes.filter((h) => h !== candidateHash)
    await sql`
      UPDATE users SET two_factor_backup_codes = ${remaining}, updated_at = NOW()
      WHERE id = ${userId}
    `
    return true
  }

  return false
}

export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  const rows = await sql`SELECT two_factor_enabled FROM users WHERE id = ${userId}`
  return rows.length > 0 && rows[0].two_factor_enabled === true
}
