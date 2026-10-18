import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { sendEmail, isResendConfigured } from '@/lib/services/email'
import crypto from 'crypto'
import { z } from 'zod'
import { hitRateLimit, clientIp } from '@/lib/rate-limit'

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = forgotPasswordSchema.parse(body)

    // Limit reset emails per address and per network address so this can't be
    // used to flood an inbox. Over the limit nothing is sent, but the answer is
    // the same as always, so it reveals nothing about the account.
    const byEmail = await hitRateLimit(`reset:email:${email.toLowerCase()}`, 3, 60 * 60)
    const byIp = byEmail.allowed ? await hitRateLimit(`reset:ip:${clientIp(request)}`, 10, 60 * 60) : byEmail
    const users = byEmail.allowed && byIp.allowed
      ? await sql`SELECT id, email, first_name FROM users WHERE email = ${email.toLowerCase()}`
      : []

    if (users.length > 0) {
      const user = users[0]

      // BUG FIX: this used to generate a token, log it to the console, and
      // discard it — there was no table to store it in and no route to
      // redeem it, so "forgot password" never actually worked. It now
      // stores a hash of the token and emails the raw token as a link.
      const resetToken = crypto.randomUUID()
      const tokenHash = hashToken(resetToken)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      await sql`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
        VALUES (${user.id}, ${tokenHash}, ${expiresAt.toISOString()}, NOW())
      `

      const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`

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
      } else if (process.env.NODE_ENV !== 'production') {
        // Local/dev fallback only — never log real reset links in production.
        console.log(`[Password Reset] (dev only, email not configured) ${resetUrl}`)
      } else {
        console.error('Password reset requested but RESEND_API_KEY is not configured')
      }
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email, you will receive reset instructions.',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address' },
        { status: 400 }
      )
    }

    console.error('Forgot password error:', error)
    return NextResponse.json(
      { success: false, error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
