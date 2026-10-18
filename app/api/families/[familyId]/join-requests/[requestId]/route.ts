import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { ensureInviteTables, canManageInvites, activateMember, belongsToOtherFamily, CROSS_FAMILY_ROLES, type MemberRole } from "@/lib/family-invites"
import { createNotification } from "@/lib/notifications"

// grantRole only matters for someone who already belongs to another family:
// they are approved as a Guardian or a Guest (default Guest), never a Parent.
const schema = z.object({ action: z.enum(["approve", "deny"]), grantRole: z.enum(CROSS_FAMILY_ROLES).optional() })

const ROLE_WORD: Record<string, string> = { PARENT: "parent", GUARDIAN: "guardian", GUEST: "guest" }

export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string; requestId: string }> }) {
  try {
    const { familyId, requestId } = await params
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    if (!(await canManageInvites(familyId, user.id))) {
      return NextResponse.json({ success: false, error: "Only the family owner or a parent can answer join requests" }, { status: 403 })
    }
    const { action, grantRole } = schema.parse(await request.json())
    await ensureInviteTables()

    const rows = await sql`
      SELECT r.id, r.user_id, r.role, r.nickname, r.status, f.name AS family_name
      FROM family_join_requests r JOIN families f ON f.id = r.family_id
      WHERE r.id = ${requestId} AND r.family_id = ${familyId} LIMIT 1
    `
    const r = rows[0]
    if (!r) return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    if (r.status !== "PENDING") return NextResponse.json({ success: false, error: "This request was already answered" }, { status: 409 })

    if (action === "approve") {
      const subscription = await checkFamilySubscription(familyId)
      // Children have their own limit; the member cap counts everyone else.
      const count = await sql`SELECT COUNT(*) AS count FROM family_members WHERE family_id = ${familyId} AND is_active = true AND role != 'CHILD'`
      if (Number(count[0].count) >= subscription.features.maxFamilyMembers) {
        return NextResponse.json({ success: false, error: `This family has reached its member limit (${subscription.features.maxFamilyMembers}).` }, { status: 400 })
      }
    }

    const upd = await sql`
      UPDATE family_join_requests
      SET status = ${action === "approve" ? "APPROVED" : "DENIED"}, decided_at = NOW(), decided_by = ${user.id}
      WHERE id = ${requestId} AND status = 'PENDING' RETURNING id
    `
    if (upd.length === 0) return NextResponse.json({ success: false, error: "This request was already answered" }, { status: 409 })

    // Someone who already belongs to another family is approved as the
    // Guardian or Guest the approver picked (default Guest). activateMember
    // also refuses PARENT for them, so this path can never grant PARENT.
    let grantedRole: MemberRole = "PARENT"
    if (action === "approve") {
      if (await belongsToOtherFamily(familyId, r.user_id)) grantedRole = grantRole ?? "GUEST"
      await activateMember({ familyId, userId: r.user_id, role: grantedRole, nickname: r.nickname || "Member" })
    }

    await createNotification({
      userId: r.user_id,
      type: "FAMILY_INVITATION",
      title: action === "approve" ? `Welcome to ${r.family_name}` : "Join request declined",
      body: action === "approve" ? `You were approved to join ${r.family_name} as a ${ROLE_WORD[grantedRole] || "member"}. Open Togethr to get started.` : `Your request to join ${r.family_name} was declined.`,
      data: { subType: "JOIN_REQUEST_RESULT", outcome: action === "approve" ? "APPROVED" : "DENIED", familyId },
      channels: ["in_app", "push"],
    }).catch((e) => console.error("join result notify failed:", e))

    await logAuditEvent(user.id, "UPDATE", "family_join_request", requestId, {
      newValue: { action, familyId, userId: r.user_id, ...(action === "approve" ? { role: grantedRole } : {}) },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    return NextResponse.json({ success: true, data: { status: action === "approve" ? "APPROVED" : "DENIED" } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Answer join request error:", error)
    return NextResponse.json({ success: false, error: "Failed to answer request" }, { status: 500 })
  }
}
