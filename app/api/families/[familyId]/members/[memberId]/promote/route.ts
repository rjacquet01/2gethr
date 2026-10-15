import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { canManageFamily } from "@/lib/permissions"
import { getRolePermissions } from "@/lib/family-invites"
import { createNotification } from "@/lib/notifications"
import { ensureAgeColumns } from "@/lib/age-schema"
import { ADULT_AGE, ageFromDob, birthdayDate } from "@/lib/age"

const schema = z.object({ to: z.enum(["GUARDIAN", "ADULT"]) })
const ROLE_WORD = { GUARDIAN: "Guardian", ADULT: "Adult" } as const

// A CHILD member who has turned 18 becomes a Guardian or an Adult member.
// Parent/owner only. Their child_profiles row is kept (history) but they stop
// appearing in children lists, which only show role = 'CHILD'.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    if (!(await canManageFamily(familyId, user.id))) {
      return NextResponse.json({ success: false, error: "Only a parent or the family owner can change a member's role" }, { status: 403 })
    }

    const { to } = schema.parse(await request.json())
    await ensureAgeColumns()

    const rows = await sql`
      SELECT fm.id, fm.user_id, fm.role, f.name AS family_name,
             cp.id AS child_profile_id, cp.display_name, to_char(cp.date_of_birth, 'YYYY-MM-DD') AS dob
      FROM family_members fm
      JOIN families f ON f.id = fm.family_id
      LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
      WHERE fm.id = ${memberId} AND fm.family_id = ${familyId} AND fm.is_active = true
      LIMIT 1
    `
    const m = rows[0]
    if (!m) return NextResponse.json({ success: false, error: "Member not found" }, { status: 404 })
    const name = (m.display_name as string) || "This member"

    if (m.role !== "CHILD") {
      return NextResponse.json({ success: false, error: `${name} is not a child member, so there is nothing to promote.` }, { status: 400 })
    }
    if (!m.user_id) {
      return NextResponse.json(
        { success: false, error: `${name} doesn't have their own account yet. Invite them to create an account first - you can choose their role once they join.` },
        { status: 400 }
      )
    }
    if (!m.dob) {
      return NextResponse.json({ success: false, error: `Add ${name}'s birthdate first so we can confirm they are 18.` }, { status: 400 })
    }
    const age = ageFromDob(m.dob)
    if (age === null || age < ADULT_AGE) {
      return NextResponse.json(
        { success: false, error: `${name} isn't 18 yet (turns 18 on ${birthdayDate(m.dob, ADULT_AGE)}).` },
        { status: 400 }
      )
    }

    const p = getRolePermissions(to)
    const upd = await sql`
      UPDATE family_members
      SET role = ${to}, can_create_events = ${p.canCreateEvents}, requires_event_approval = ${p.requiresEventApproval},
          can_override_conflicts = ${p.canOverrideConflicts}, can_view_family_calendar = ${p.canViewFamilyCalendar},
          can_invite_members = ${p.canInviteMembers}, updated_at = NOW()
      WHERE id = ${memberId} AND role = 'CHILD'
      RETURNING id
    `
    if (upd.length === 0) {
      return NextResponse.json({ success: false, error: `${name}'s role was already changed.` }, { status: 409 })
    }

    // A new adult starts with location sharing off; they turn it on themselves.
    await sql`
      UPDATE location_settings
      SET mode = 'OFF', share_with_family = false, last_mode_change = NOW(), updated_at = NOW()
      WHERE family_member_id = ${memberId}
    `

    await logAuditEvent(user.id, "UPDATE", "family_member_promote", memberId, {
      oldValue: { role: "CHILD" },
      newValue: { role: to, familyId, childProfileId: m.child_profile_id },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    await createNotification({
      userId: m.user_id,
      type: "SYSTEM",
      title: `You're now a ${ROLE_WORD[to]} member`,
      body: `You're now a ${ROLE_WORD[to]} member of ${m.family_name}. Your location sharing is off until you turn it on.`,
      data: { subType: "ROLE_PROMOTED", role: to, familyId },
    }).catch((e) => console.error("promotion notify failed:", e))

    return NextResponse.json({ success: true, data: { memberId, role: to } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Promote member error:", error)
    return NextResponse.json({ success: false, error: "Failed to change role" }, { status: 500 })
  }
}
