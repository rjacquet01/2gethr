import crypto from 'crypto'
import { sql } from '@/lib/db'
import { sendEmail, isResendConfigured } from '@/lib/services/email'
import { appUrl } from '@/lib/app-url'

// One-hour, single-use password reset links. Only the token's hash is stored.
// Used by "Forgot password" and by an admin's "Send password reset link";
// nobody but the account holder ever sees or sets the new password.

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Create a reset token for this user and email them the link. Returns whether an email was sent. */
export async function sendPasswordResetLink(user: { id: string; email: string; first_name?: string | null }): Promise<boolean> {
  const resetToken = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await sql`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
    VALUES (${user.id}, ${hashResetToken(resetToken)}, ${expiresAt.toISOString()}, NOW())
  `

  const resetUrl = `${appUrl()}/reset-password?token=${resetToken}`

  if (isResendConfigured()) {
    await sendEmail({
      to: user.email,
      subject: 'Reset your Togethr password',
      html: `
        <p>Hi ${user.first_name || 'there'},</p>
        <p>We received a request to reset your Togethr password. This link expires in 1 hour.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
      text: `Reset your Togethr password: ${resetUrl} (expires in 1 hour)`,
    })
    return true
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Password Reset] (dev only, email not configured) ${resetUrl}`)
  } else {
    console.error('Password reset requested but RESEND_API_KEY is not configured')
  }
  return false
}
