import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { sendPasswordResetLink } from '@/lib/password-reset'
import { z } from 'zod'
import { hitRateLimit, clientIp } from '@/lib/rate-limit'

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

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
      await sendPasswordResetLink({ id: user.id as string, email: user.email as string, first_name: user.first_name as string | null })
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
