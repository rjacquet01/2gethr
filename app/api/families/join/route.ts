import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { ensureInviteTables, activateMember, INVITE_ROLES, type InviteRole } from "@/lib/family-invites"
import { alertFamilyAdults } from "@/lib/family-alerts"
import { ensureAgeColumns } from "@/lib/age-schema"
import { MIN_ACCOUNT_AGE, effectiveAge } from "@/lib/age"

type JoiningUser = { id: string; firstName?: string | null; lastName?: string | null }

/**
 * Join with a child account invite: attach the user to the existing
 * accountless CHILD membership the invite was made for. Same single-use rule
 * as any code; the age rule (8+) is checked again here. Location sharing
 * stays off - the child profile keeps its OFF settings.
 */
async function linkChildAccount(
  request: NextRequest,
  opts: { inviteId: string; familyId: string; familyName: string; childMemberId: string; user: JoiningUser; hasOldMembership: boolean }
) {
  const { inviteId, familyId, familyName, childMemberId, user } = opts
  if (opts.hasOldMembership) {
    return NextResponse.json(
      { success: false, error: "This account was in this family before. Ask a parent for help, or sign in with a different account." },
      { status: 400 }
    )
  }
  await ensureAgeColumns()

  const child = await sql`
    SELECT fm.id, fm.user_id, fm.role, cp.display_name, cp.age, to_char(cp.date_of_birth, 'YYYY-MM-DD') AS dob
    FROM family_members fm JOIN child_profiles cp ON cp.family_member_id = fm.id
    WHERE fm.id = ${childMemberId} AND fm.family_id = ${familyId}
    LIMIT 1
  `
  const c = child[0]
  if (!c || c.role !== "CHILD" || c.user_id) {
    return NextResponse.json({ success: false, error: "This account invite is no longer valid. Ask a parent for a new one." }, { status: 400 })
  }
  const age = effectiveAge(c.dob, c.age)
  if (age === null || age < MIN_ACCOUNT_AGE) {
    return NextResponse.json({ success: false, error: `Children can have their own account from age ${MIN_ACCOUNT_AGE}. Ask a parent for help.` }, { status: 400 })
  }

  // Use up the code. Only one person can ever win this update.
  const consumed = await sql`
    UPDATE family_invites SET used_at = NOW(), used_by = ${user.id}
    WHERE id = ${inviteId} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    RETURNING id
  `
  if (consumed.length === 0) {
    return NextResponse.json({ success: false, error: "This invite code was already used. Ask for a new one." }, { status: 400 })
  }

  try {
    const linked = await sql`
      UPDATE family_members SET user_id = ${user.id}, is_active = true, updated_at = NOW()
      WHERE id = ${childMemberId} AND family_id = ${familyId} AND user_id IS NULL AND role = 'CHILD'
      RETURNING id
    `
    if (linked.length === 0) {
      await sql`UPDATE family_invites SET used_at = NULL, used_by = NULL WHERE id = ${inviteId} AND used_by = ${user.id}`
      return NextResponse.json({ success: false, error: "This account invite is no longer valid. Ask a parent for a new one." }, { status: 400 })
    }

    // Location sharing stays off until it is turned on.
    const ls = await sql`
      UPDATE location_settings SET mode = 'OFF', share_with_family = false, updated_at = NOW()
      WHERE family_member_id = ${childMemberId} RETURNING id
    `
    if (ls.length === 0) {
      await sql`
        INSERT INTO location_settings (id, family_member_id, mode, share_with_family, update_interval_sec, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${childMemberId}, 'OFF', false, 300, NOW(), NOW())
      `
    }

    await logAuditEvent(user.id, "UPDATE", "child_account_linked", childMemberId, {
      newValue: { familyId, inviteId },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    const name = (c.display_name as string) || `${user.firstName || ""}`.trim() || "Your child"
    try {
      await alertFamilyAdults(familyId, user.id, {
        title: "Child account ready",
        body: `${name} now has their own Togethr account in ${familyName}.`,
        type: "FAMILY_INVITATION",
        data: { subType: "CHILD_ACCOUNT_LINKED", familyId, memberId: childMemberId },
        clickAction: "/family",
        soft: true,
      })
    } catch (e) {
      console.error("child account alert failed (non-fatal):", e)
    }

    return NextResponse.json({
      success: true,
      data: { familyId, familyName, membershipId: childMemberId, role: "CHILD", status: "JOINED" },
      message: "Your account is now linked to your family",
    })
  } catch (inner) {
    try {
      await sql`UPDATE family_invites SET used_at = NULL, used_by = NULL WHERE id = ${inviteId} AND used_by = ${user.id}`
    } catch (restoreErr) {
      console.error("failed to restore invite after child link error:", restoreErr)
    }
    throw inner
  }
}

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
      SELECT i.id, i.family_id, i.role, i.expires_at, i.used_at, i.revoked_at, i.child_member_id, f.name AS family_name
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

    // family_invites.role is TEXT; only accept the roles a code can carry.
    if (!(INVITE_ROLES as readonly string[]).includes(invite.role)) {
      return NextResponse.json({ success: false, error: "Invalid invite code. Ask for a new one." }, { status: 400 })
    }
    const role = invite.role as InviteRole
    const familyId = invite.family_id as string
    const displayName = (nickname || user.firstName || "Member") as string

    // A deleted family has no active members left: its old codes are dead.
    const live = await sql`SELECT 1 FROM family_members WHERE family_id = ${familyId} AND is_active = true LIMIT 1`
    if (live.length === 0) {
      return NextResponse.json({ success: false, error: "This family no longer exists." }, { status: 400 })
    }

    const existing = await sql`SELECT is_active FROM family_members WHERE family_id = ${familyId} AND user_id = ${user.id} LIMIT 1`
    if (existing.length > 0 && existing[0].is_active) {
      return NextResponse.json({ success: false, error: "You are already a member of this family" }, { status: 400 })
    }

    // An account invite for an existing child profile: link this login to
    // that child's membership. It doesn't add a seat (the child already has one).
    if (invite.child_member_id) {
      return await linkChildAccount(request, {
        inviteId: invite.id as string,
        familyId,
        familyName: invite.family_name as string,
        childMemberId: invite.child_member_id as string,
        user,
        hasOldMembership: existing.length > 0,
      })
    }

    const subscription = await checkFamilySubscription(familyId)
    // Children have their own limit; the member cap counts everyone else.
    const memberCount = await sql`SELECT COUNT(*) AS count FROM family_members WHERE family_id = ${familyId} AND is_active = true AND role != 'CHILD'`
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

    // If anything fails after the code is used up, give the code back so it isn't burned.
    try {
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

      if (role === "GUEST") {
        // Guests join right away: calendar and tasks only, no child profile
        // and no location settings.
        const memberId = await activateMember({ familyId, userId: user.id, role: "GUEST", nickname: displayName })
        const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || displayName
        try {
          await alertFamilyAdults(familyId, user.id, {
            title: "New guest",
            body: `${fullName} joined ${invite.family_name} as a guest.`,
            type: "FAMILY_INVITATION",
            data: { subType: "GUEST_JOINED", familyId },
            clickAction: "/family",
            soft: true,
          })
        } catch (e) {
          console.error("guest joined alert failed (non-fatal):", e)
        }
        await logAuditEvent(user.id, "CREATE", "family_member", memberId, { newValue: { familyId, role, nickname: displayName }, ipAddress: ip, userAgent: ua })
        return NextResponse.json({
          success: true,
          data: { familyId, familyName: invite.family_name, membershipId: memberId, role, status: "JOINED" },
          message: "Joined family as a guest",
        })
      }

      const memberId = await activateMember({ familyId, userId: user.id, role: "CHILD", nickname: displayName })
      await logAuditEvent(user.id, "CREATE", "family_member", memberId, { newValue: { familyId, role, nickname: displayName }, ipAddress: ip, userAgent: ua })
      return NextResponse.json({
        success: true,
        data: { familyId, familyName: invite.family_name, membershipId: memberId, role, status: "JOINED" },
        message: "Joined family successfully",
      })
    } catch (inner) {
      try {
        await sql`UPDATE family_invites SET used_at = NULL, used_by = NULL WHERE id = ${invite.id} AND used_by = ${user.id}`
      } catch (restoreErr) {
        console.error("failed to restore invite after join error:", restoreErr)
      }
      throw inner
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }
    console.error("Join family error:", error)
    return NextResponse.json({ success: false, error: "Failed to join family" }, { status: 500 })
  }
}
