import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { getUserFromRequest, hashPassword, verifyPassword, logAuditEvent } from '@/lib/auth'

// Lets a signed-in user change their own password (Settings > Security >
// Change Password). Requires the current password, and uses the same
// strength rules as registration / reset-password.

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and number'
    ),
})

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { currentPassword, newPassword } = changePasswordSchema.parse(body)

    const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`
    const currentHash: string | null = rows[0]?.password_hash ?? null

    if (!currentHash || !(await verifyPassword(currentPassword, currentHash))) {
      return NextResponse.json(
        { success: false, error: 'Current password is incorrect' },
        { status: 400 }
      )
    }

    if (await verifyPassword(newPassword, currentHash)) {
      return NextResponse.json(
        { success: false, error: 'New password must be different from your current password' },
        { status: 400 }
      )
    }

    const newHash = await hashPassword(newPassword)
    await sql`UPDATE users SET password_hash = ${newHash}, updated_at = NOW() WHERE id = ${user.id}`

    // Sign out every OTHER device/session, but keep this one signed in so the
    // person isn't kicked out of the screen they just used.
    const cookieStore = await cookies()
    const currentRefresh = cookieStore.get('refresh_token')?.value ?? null
    if (currentRefresh) {
      await sql`
        UPDATE refresh_tokens SET revoked_at = NOW()
        WHERE user_id = ${user.id} AND revoked_at IS NULL AND token <> ${currentRefresh}
      `
    } else {
      await sql`
        UPDATE refresh_tokens SET revoked_at = NOW()
        WHERE user_id = ${user.id} AND revoked_at IS NULL
      `
    }

    try {
      await logAuditEvent(user.id, 'UPDATE', 'user_password', user.id, {
        metadata: { action: 'password_changed' },
      })
    } catch (auditError) {
      console.error('Change password audit log failed:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: 'Password updated. Other devices have been signed out.',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error('Change password error:', error)
    return NextResponse.json(
      { success: false, error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
