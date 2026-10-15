import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { canManageFamily } from "@/lib/permissions"
import { ensureAgeColumns } from "@/lib/age-schema"

const SNOOZE_DAYS = 30

// "Keep as child" on the 18th-birthday card: hide the role prompt for 30 days.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    if (!(await canManageFamily(familyId, user.id))) {
      return NextResponse.json({ success: false, error: "Only a parent or the family owner can do this" }, { status: 403 })
    }
    await ensureAgeColumns()

    const upd = await sql`
      UPDATE child_profiles cp
      SET adult_prompt_snoozed_until = NOW() + make_interval(days => ${SNOOZE_DAYS}::int), updated_at = NOW()
      FROM family_members fm
      WHERE cp.family_member_id = fm.id AND fm.id = ${memberId} AND fm.family_id = ${familyId}
        AND fm.is_active = true AND fm.role = 'CHILD'
      RETURNING cp.adult_prompt_snoozed_until
    `
    if (upd.length === 0) {
      return NextResponse.json({ success: false, error: "Child not found" }, { status: 404 })
    }

    await logAuditEvent(user.id, "UPDATE", "adult_prompt_snooze", memberId, {
      newValue: { familyId, snoozedUntil: upd[0].adult_prompt_snoozed_until },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    return NextResponse.json({ success: true, data: { snoozedUntil: upd[0].adult_prompt_snoozed_until } })
  } catch (error) {
    console.error("Snooze adult prompt error:", error)
    return NextResponse.json({ success: false, error: "Failed to snooze" }, { status: 500 })
  }
}
