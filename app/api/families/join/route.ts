import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { ensureInviteTables, activateMember } from "@/lib/family-invites"
import { alertFamilyAdults } from "@/lib/family-alerts"

// The role is decided by the invite code, never by the person joining, so a
// "role" sent in the body is ignored (zod strips unknown keys).
const joinFamilySchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required"),
  nickname: z.string().max(50).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    }

    const { inviteCode, nickname } = joinFamilySchema.parse(await request.json())
    await ensureInviteTables()

    const invites = await sql`
      SELECT i.id, i.family_id, i.role, i.expires_at, i.used_at, i.revoked_at, f.name AS family_name
      FROM family_invites i JOIN families f ON f.id = i.family_id
      WHERE i.code = ${inviteCode.trim().toUpperCase()} LIMIT 1
    `
    if (invites.length === 0) {
      return NextResponse.json({ success: false, error: "Invalid invite code. Ask for a new one." }, { status: 404 })
    }
    const invite = invites[0]
    if (invite.revoked_at) {
      return NextResponse.json({ success: false, error: "This invite code was cancelled. Ask for a new one." }, { status: 400 })
    }
    if (invite.used_at) {
      return NextResponse.json({ success: false, error: "This invite code was already used. Ask for a new one." }, { status: 400 })
    }
    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: "This invite code has expired. Ask for a new one." }, { status: 400 })
    }

    const role = invite.role as "PARENT" | "CHILD"
    const familyId = invite.family_id as string
    const displayName = (nickname || user.firstName || "Member") as string

    const existing = await sql`SELECT is_active FROM family_members WHERE family_id = ${familyId} AND user_id = ${user.id} LIMIT 1`
    if (existing.length > 0 && existing[0].is_active) {
      return NextResponse.json({ success: false, error: "You are already a member of this family" }, { status: 400 })
    }

    const subscription = await checkFamilySubscription(familyId)
    const memberCount = await sql`SELECT COUNT(*) AS count FROM family_members WHERE family_id = ${familyId} AND is_active = true`
    if (Number(memberCount[0].count) >= subscription.features.maxFamilyMembers) {
      return NextResponse.json(
        { success: false, error: `This family has reached its member limit (${subscription.features.maxFamilyMembers}). The family owner needs to upgrade their subscription.` },
        { status: 400 }
      )
    }

    // Use up the code. Only one person can ever win this update.
    const consumed = await sql`
      UPDATE family_invites SET used_at = NOW(), used_by = ${user.id}
      WHERE id = ${invite.id} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING id
    `
    if (consumed.length === 0) {
      return NextResponse.json({ success: false, error: "This invite code was already used. Ask for a new one." }, { status: 400 })
    }

    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined
    const ua = request.headers.get("user-agent") || undefined

    if (role === "PARENT") {
      // Parents must be approved by an existing parent before they get access.
      const requestId = crypto.randomUUID()
      await sql`
        INSERT INTO family_join_requests (id, family_id, user_id, invite_id, role, nickname, status)
        VALUES (${requestId}, ${familyId}, ${user.id}, ${invite.id}, 'PARENT', ${displayName}, 'PENDING')
      `
      const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || displayName
      try {
        await alertFamilyAdults(familyId, user.id, {
          title: "Parent join request",
          body: `${fullName} used a parent invite code for ${invite.family_name}. Open Togethr > Family to approve or decline.`,
          type: "FAMILY_INVITATION",
          data: { subType: "JOIN_REQUEST", requestId, familyId },
          clickAction: "/family",
          soft: true,
        })
      } catch (e) {
        console.error("join request alert failed (non-fatal):", e)
      }
      await logAuditEvent(user.id, "CREATE", "family_join_request", requestId, { newValue: { familyId, role }, ipAddress: ip, userAgent: ua })
      return NextResponse.json({
        success: true,
        data: { familyId, familyName: invite.family_name, role, status: "PENDING_APPROVAL", requestId },
        message: "Request sent. A parent in the family needs to approve you.",
      })
    }

    const memberId = await activateMember({ familyId, userId: user.id, role: "CHILD", nickname: displayName })
    await logAuditEvent(user.id, "CREATE", "family_member", memberId, { newValue: { familyId, role, nickname: displayName }, ipAddress: ip, userAgent: ua })
    return NextResponse.json({
      success: true,
      data: { familyId, familyName: invite.family_name, membershipId: memberId, role, status: "JOINED" },
      message: "Joined family successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }
    console.error("Join family error:", error)
    return NextResponse.json({ success: false, error: "Failed to join family" }, { status: 500 })
  }
}
