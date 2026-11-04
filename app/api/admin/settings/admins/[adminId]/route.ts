import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { notifyAccountChange, requestIp } from '@/lib/admin-account-alerts'

// Deactivate an admin (SUPER_ADMIN only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ adminId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if super admin
    if (!admin.roles.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Only super admins can deactivate admins' }, { status: 403 })
    }

    const { adminId } = await params

    // Cannot deactivate yourself
    if (adminId === admin.id) {
      return NextResponse.json({ error: 'Cannot deactivate yourself' }, { status: 400 })
    }

    // Check if target admin exists
    const targetAdmin = await sql`SELECT id, email, status FROM admin_users WHERE id = ${adminId}`
    if (targetAdmin.length === 0) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    // Deactivate admin
    await sql`
      UPDATE admin_users SET status = 'SUSPENDED', updated_at = NOW()
      WHERE id = ${adminId}
    `

    // Log the action
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
    await logAdminAction(admin.id, 'DEACTIVATE_ADMIN', 'admin_user', adminId, { email: targetAdmin[0].email }, ipAddress)
    if (targetAdmin[0].status !== 'SUSPENDED') {
      await notifyAccountChange({
        actor: admin.email,
        actorType: 'admin',
        accountEmail: targetAdmin[0].email,
        change: 'Admin user deactivated',
        ipAddress: requestIp(request),
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Deactivate admin error:', error)
    return NextResponse.json({ error: 'Failed to deactivate admin' }, { status: 500 })
  }
}
