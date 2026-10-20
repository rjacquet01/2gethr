import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, adminMfaRequired } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Allowed without two-step sign-in, so the portal can send them to set it up.
    const admin = await getAdminFromToken(token, { allowWithoutMfa: true })
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    return NextResponse.json({
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        roles: admin.roles,
        permissions: admin.permissions,
        mfaSetupRequired: adminMfaRequired() && !admin.mfaEnabled,
      },
    })
  } catch (error) {
    console.error('Admin me error:', error)
    return NextResponse.json({ error: 'Failed to get admin' }, { status: 500 })
  }
}
