import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { hashPassword, revokeAllUserTokens } from '@/lib/auth'
import { notifyAccountChange, requestIp } from '@/lib/admin-account-alerts'
import crypto from 'crypto'
import { z } from 'zod'

// This route did not exist before: the forgot-password flow generated a
// token and threw it away, so there was no way to actually complete a
// password reset. This validates the emailed token and sets the new password.

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and number'
    ),
})

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, password } = resetPasswordSchema.parse(body)

    const tokenHash = hashToken(token)

    const tokens = await sql`
      SELECT id, user_id, expires_at, used_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
    `

    if (tokens.length === 0) {
      return NextResponse.json(
        { success: false, error: 'This reset link is invalid.' },
        { status: 400 }
      )
    }

    const resetToken = tokens[0]

    if (resetToken.used_at) {
      return NextResponse.json(
        { success: false, error: 'This reset link has already been used.' },
        { status: 400 }
      )
    }

    if (new Date(resetToken.expires_at) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    const passwordHash = await hashPassword(password)

    const updated = await sql`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = NOW()
      WHERE id = ${resetToken.user_id}
      RETURNING email
    `

    await sql`
      UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ${resetToken.id}
    `

    // Invalidate any existing sessions so a stolen session can't survive a reset.
    await revokeAllUserTokens(resetToken.user_id)

    if (updated[0]?.email) {
      await notifyAccountChange({
        actor: updated[0].email,
        actorType: 'user',
        accountEmail: updated[0].email,
        change: 'Password reset by email link',
        ipAddress: requestIp(request),
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully. Please sign in with your new password.',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error('Reset password error:', error)
    return NextResponse.json(
      { success: false, error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
