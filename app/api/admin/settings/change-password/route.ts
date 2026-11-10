import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getAdminFromToken, logAdminAction, revokeAdminSessions } from '@/lib/admin-auth'
import { hitRateLimit, tooManyRequests } from '@/lib/rate-limit'
import { sql } from '@/lib/db'
import { notifyAccountChange, requestIp } from '@/lib/admin-account-alerts'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Slow down guessing of the current password from a stolen session.
    const pwLimit = await hitRateLimit(`admin-change-password:${admin.id}`, 5, 900)
    if (!pwLimit.allowed) return tooManyRequests(pwLimit.retryAfterSec)

    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current and new passwords are required' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
    }

    // Get current password hash
    const adminResult = await sql`
      SELECT password_hash FROM admin_users WHERE id = ${admin.id}
    `

    if (adminResult.length === 0) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, adminResult[0].password_hash)
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10)

    // Update password
    await sql`
      UPDATE admin_users SET password_hash = ${newHash}, updated_at = NOW()
      WHERE id = ${admin.id}
    `

    // Sign out every other session: a changed password should end a stolen one.
    await revokeAdminSessions(admin.id)

    // Log the action
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
    await logAdminAction(admin.id, 'CHANGE_PASSWORD', 'admin_user', admin.id, {}, ipAddress)
    await notifyAccountChange({
      actor: admin.email,
      actorType: 'admin',
      accountEmail: admin.email,
      change: 'Admin password changed',
      ipAddress: requestIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
