import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminFromToken, hasPermission, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { withdrawChildConsent } from '@/lib/parental-consent'

const schema = z.object({
  reason: z.string({ required_error: 'A reason is required' }).trim().min(1, 'A reason is required').max(1000),
  // The admin typed DELETE in the confirmation box.
  confirm: z.literal('DELETE', { errorMap: () => ({ message: 'Type DELETE to confirm' }) }),
})

// Delete a child profile that has no login (docs/COPPA_RUNBOOK.md), e.g. when
// a parent emails admin@mytogethr.com. Uses the same deletion as a parent's
// consent withdrawal: consent rows are marked withdrawn (by this admin) and
// kept as proof, then the child's profile, location settings and place
// assignments are deleted. Other family members are never touched. A child
// with their own login is refused here: close that account under Users.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!hasPermission(admin, 'families.update')) {
      return NextResponse.json({ error: 'No permission to delete child profiles' }, { status: 403 })
    }

    const { familyId, memberId } = await params
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const { reason } = parsed.data

    const rows = await sql`
      SELECT fm.id, fm.user_id, fm.role, cp.display_name
      FROM family_members fm
      LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
      WHERE fm.id = ${memberId} AND fm.family_id = ${familyId}
      LIMIT 1
    `
    const child = rows[0]
    if (!child || child.role !== 'CHILD') {
      return NextResponse.json({ error: 'Child not found in this family' }, { status: 404 })
    }
    if (child.user_id) {
      return NextResponse.json(
        { error: 'This child has their own login. Close that account under Users instead.' },
        { status: 400 }
      )
    }

    // Audit first, while the child's name still exists.
    await logAdminAction(
      admin.id,
      'DELETE_CHILD_PROFILE',
      'family_member',
      memberId,
      { familyId, childMemberId: memberId, childName: child.display_name ?? null, reason },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    )
    const result = await withdrawChildConsent({ familyId, childMemberId: memberId, withdrawnBy: admin.id })

    return NextResponse.json({ success: true, deleted: result.deleted, message: 'Child profile deleted' })
  } catch (error) {
    console.error('Admin delete child profile error:', error)
    return NextResponse.json({ error: 'Failed to delete child profile' }, { status: 500 })
  }
}
