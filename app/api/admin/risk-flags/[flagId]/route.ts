import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getAdminFromToken, hasPermission, logAdminAction } from '@/lib/admin-auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ flagId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Real seeded key is 'trust.update' (see scripts/003-admin-schema.sql); this
    // used to check the nonexistent 'risk_flags.write' and 403'd every TRUST_SAFETY admin.
    if (!hasPermission(admin, 'trust.update')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { flagId } = await params
    const { resolution } = await request.json()

    if (!resolution?.trim()) {
      return NextResponse.json({ error: 'Resolution notes required' }, { status: 400 })
    }

    // Get flag details first
    const existing = await sql`
      SELECT * FROM risk_flags WHERE id = ${flagId}
    `

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Risk flag not found' }, { status: 404 })
    }

    // Update flag
    await sql`
      UPDATE risk_flags
      SET
        status = 'RESOLVED',
        reviewed_at = NOW(),
        reviewed_by_admin_id = ${admin.id}::uuid,
        resolution_notes = ${resolution.trim()},
        updated_at = NOW()
      WHERE id = ${flagId}::uuid
    `

    // Log action - metadata must be the 5th argument (an object), not the
    // Request object; this used to pass `request` here, corrupting the
    // audit trail for every risk-flag resolution.
    await logAdminAction(
      admin.id,
      'RESOLVE_RISK_FLAG',
      'risk_flag',
      flagId,
      { resolution: resolution.trim(), flagType: existing[0].flag_type },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error resolving risk flag:', error)
    return NextResponse.json({ error: 'Failed to resolve flag' }, { status: 500 })
  }
}
