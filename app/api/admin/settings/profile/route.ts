import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { changedFields, notifyAccountChange, requestIp } from '@/lib/admin-account-alerts'

export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { firstName, lastName } = await request.json()

    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'First name and last name are required' }, { status: 400 })
    }

    // Update profile
    await sql`
      UPDATE admin_users 
      SET first_name = ${firstName}, last_name = ${lastName}, updated_at = NOW()
      WHERE id = ${admin.id}
    `

    // Log the action
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
    await logAdminAction(admin.id, 'UPDATE_PROFILE', 'admin_user', admin.id, { firstName, lastName }, ipAddress)
    await notifyAccountChange({
      actor: admin.email,
      actorType: 'admin',
      accountEmail: admin.email,
      change: 'Admin profile updated',
      details: changedFields({ firstName: admin.firstName, lastName: admin.lastName }, { firstName, lastName }),
      ipAddress: requestIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update profile error:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
