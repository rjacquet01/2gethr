import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, hasPermission, logAdminAction } from '@/lib/admin-auth'
import { hashPassword } from '@/lib/auth'
import { sql } from '@/lib/db'
import crypto from 'crypto'

// Get user details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin || !hasPermission(admin, 'users.read')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId } = await params

    // Get user with family info
    const userResult = await sql`
      SELECT
        u.id, u.email, u.first_name, u.last_name, u.phone,
        u.is_active, u.email_verified, u.created_at, u.last_login_at,
        u.timezone, u.date_of_birth
      FROM users u
      WHERE u.id = ${userId}
    `

    if (userResult.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const user = userResult[0]

    // Get user's families
    const families = await sql`
      SELECT
        f.id, f.name, fm.role, fm.joined_at, fm.is_active,
        s.tier, s.status as subscription_status
      FROM family_members fm
      JOIN families f ON fm.family_id = f.id
      LEFT JOIN subscriptions s ON f.id = s.family_id
      WHERE fm.user_id = ${userId}
      ORDER BY fm.joined_at DESC
    `

    // Get recent activity (audit logs)
    const activity = await sql`
      SELECT action, entity_type, entity_id, created_at, metadata
      FROM audit_logs
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 20
    `

    // Log this view (for sensitive data access tracking)
    await logAdminAction(
      admin.id,
      'VIEW_USER',
      'user',
      userId,
      {},
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    )

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        isActive: user.is_active,
        emailVerified: user.email_verified,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
        timezone: user.timezone,
        dateOfBirth: user.date_of_birth,
      },
      families: families.map(f => ({
        id: f.id,
        name: f.name,
        role: f.role,
        joinedAt: f.joined_at,
        isActive: f.is_active,
        subscriptionTier: f.tier,
        subscriptionStatus: f.subscription_status,
      })),
      recentActivity: activity.map(a => ({
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        createdAt: a.created_at,
        metadata: a.metadata,
      })),
    })
  } catch (error) {
    console.error('Admin get user error:', error)
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
  }
}

// Update user (suspend/unsuspend, update info, reset password)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin || !hasPermission(admin, 'users.update')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId } = await params
    const body = await request.json()
    const { action, reason } = body

    const ipAddress = request.headers.get('x-forwarded-for') || undefined
    const userAgent = request.headers.get('user-agent') || undefined

    if (action === 'suspend') {
      if (!hasPermission(admin, 'users.suspend')) {
        return NextResponse.json({ error: 'No suspend permission' }, { status: 403 })
      }

      await sql`
        UPDATE users SET is_active = false, updated_at = NOW()
        WHERE id = ${userId}
      `

      await logAdminAction(admin.id, 'SUSPEND_USER', 'user', userId, { reason }, ipAddress, userAgent)

      return NextResponse.json({ success: true, message: 'User suspended' })
    }

    if (action === 'unsuspend') {
      if (!hasPermission(admin, 'users.suspend')) {
        return NextResponse.json({ error: 'No suspend permission' }, { status: 403 })
      }

      await sql`
        UPDATE users SET is_active = true, updated_at = NOW()
        WHERE id = ${userId}
      `

      await logAdminAction(admin.id, 'UNSUSPEND_USER', 'user', userId, { reason }, ipAddress, userAgent)

      return NextResponse.json({ success: true, message: 'User unsuspended' })
    }

    if (action === 'reset_password') {
      // Generate a temporary password and hash it with lib/auth.ts's
      // hashPassword() (bcrypt cost 12), the same function/cost consumer
      // signup and login use - this used to call bcrypt.hash(tempPassword, 10)
      // directly, a weaker, inconsistent cost factor for the same kind of
      // secret.
      const tempPassword = crypto.randomBytes(8).toString('hex')
      const hashedPassword = await hashPassword(tempPassword)

      await sql`
        UPDATE users SET password_hash = ${hashedPassword}, updated_at = NOW()
        WHERE id = ${userId}
      `

      await logAdminAction(admin.id, 'RESET_USER_PASSWORD', 'user', userId, { reason }, ipAddress, userAgent)

      // Return temp password - admin should communicate this to the user securely
      return NextResponse.json({
        success: true,
        message: 'Password reset successfully',
        tempPassword: tempPassword,
        note: 'User should change this password immediately after logging in'
      })
    }

    if (action === 'verify_email') {
      await sql`
        UPDATE users SET email_verified = true, updated_at = NOW()
        WHERE id = ${userId}
      `

      await logAdminAction(admin.id, 'VERIFY_USER_EMAIL', 'user', userId, { reason }, ipAddress, userAgent)

      return NextResponse.json({ success: true, message: 'Email verified' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Admin update user error:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}
