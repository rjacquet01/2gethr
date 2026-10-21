import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { isParentInOtherFamily, getRolePermissions } from "@/lib/family-invites"
import { canManageFamily } from "@/lib/permissions"
import { deleteChildData } from "@/lib/parental-consent"

const updateMemberSchema = z.object({
  role: z.enum(["PARENT", "GUARDIAN", "ADULT", "CHILD", "GUEST"]).optional(),
  // No nickname: names come from the account or the child's profile
  // (lib/member-names.ts). A child is renamed on their profile.
  canCreateEvents: z.boolean().optional(),
  requiresEventApproval: z.boolean().optional(),
  canOverrideConflicts: z.boolean().optional(),
  canViewFamilyCalendar: z.boolean().optional(),
  canInviteMembers: z.boolean().optional(),
})

// Update member (parent/owner only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Check if user is a PARENT in this family
    const userMembership = await sql`
      SELECT role FROM family_members 
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    // A parent, or the family owner whatever their role (canManageFamily).
    if (userMembership.length === 0 || !(await canManageFamily(familyId, user.id))) {
      return NextResponse.json(
        { success: false, error: "Only parents can update member settings" },
        { status: 403 }
      )
    }

    // Get target member
    const targetMember = await sql`
      SELECT fm.id, fm.user_id, fm.role, f.owner_id
      FROM family_members fm
      JOIN families f ON fm.family_id = f.id
      WHERE fm.id = ${memberId} AND fm.family_id = ${familyId}
    `

    if (targetMember.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member not found" },
        { status: 404 }
      )
    }

    // Cannot modify family owner
    if (targetMember[0].user_id === targetMember[0].owner_id) {
      return NextResponse.json(
        { success: false, error: "Cannot modify family owner's membership" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = updateMemberSchema.parse(body)

    // Child is never set or cleared here. A child joins only through Add child
    // (with a parent's consent) and leaves the role only through the
    // 18th-birthday promotion, which checks their age. Without this a parent
    // could make a co-parent a "child" and then withdraw consent, closing
    // their account.
    if (validatedData.role && validatedData.role !== targetMember[0].role && (validatedData.role === "CHILD" || targetMember[0].role === "CHILD")) {
      return NextResponse.json(
        { success: false, error: targetMember[0].role === "CHILD" ? "A child's role changes only when they turn 18 (on their profile)." : "Only a child added with Add child can have the child role." },
        { status: 403 }
      )
    }

    // A parent/owner of a different family can be at most a GUARDIAN here.
    if (validatedData.role === "PARENT" && (await isParentInOtherFamily(familyId, targetMember[0].user_id))) {
      return NextResponse.json(
        { success: false, error: "This person is already a parent in another family, so they can only be a guardian in this one." },
        { status: 403 }
      )
    }

    // Switching someone to ADULT or GUEST applies that role's permission
    // defaults (a guest's events always need approval) unless the request
    // sets a flag explicitly.
    if (validatedData.role === "ADULT" || validatedData.role === "GUEST") {
      const p = getRolePermissions(validatedData.role)
      validatedData.canCreateEvents ??= p.canCreateEvents
      validatedData.requiresEventApproval ??= p.requiresEventApproval
      validatedData.canOverrideConflicts ??= p.canOverrideConflicts
      validatedData.canViewFamilyCalendar ??= p.canViewFamilyCalendar
      validatedData.canInviteMembers ??= p.canInviteMembers
    }

    // Build update
    await sql`
      UPDATE family_members 
      SET 
        role = COALESCE(${validatedData.role}, role),
        can_create_events = COALESCE(${validatedData.canCreateEvents}, can_create_events),
        requires_event_approval = COALESCE(${validatedData.requiresEventApproval}, requires_event_approval),
        can_override_conflicts = COALESCE(${validatedData.canOverrideConflicts}, can_override_conflicts),
        can_view_family_calendar = COALESCE(${validatedData.canViewFamilyCalendar}, can_view_family_calendar),
        can_invite_members = COALESCE(${validatedData.canInviteMembers}, can_invite_members),
        updated_at = NOW()
      WHERE id = ${memberId}
    `

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "family_member", memberId, {
      newValue: validatedData as Record<string, unknown>,
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Member updated successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Update member error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update member" },
      { status: 500 }
    )
  }
}

// Remove member (parent/owner only, or self)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Get target member
    const targetMember = await sql`
      SELECT fm.id, fm.user_id, fm.role, f.owner_id
      FROM family_members fm
      JOIN families f ON fm.family_id = f.id
      WHERE fm.id = ${memberId} AND fm.family_id = ${familyId}
    `

    if (targetMember.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member not found" },
        { status: 404 }
      )
    }

    const member = targetMember[0]
    const isSelf = member.user_id === user.id
    const isOwner = member.owner_id === user.id

    // Cannot remove family owner
    if (member.user_id === member.owner_id) {
      return NextResponse.json(
        { success: false, error: "Family owner cannot be removed. Delete the family instead." },
        { status: 403 }
      )
    }

    // A child can't remove themselves: that deletes their profile and login,
    // which is a parent's decision.
    if (isSelf && member.role === "CHILD" && !isOwner) {
      return NextResponse.json(
        { success: false, error: "Ask a parent to remove you from this family." },
        { status: 403 }
      )
    }

    // Check permissions: must be self, owner, or parent
    if (!isSelf && !isOwner) {
      const userMembership = await sql`
        SELECT role FROM family_members 
        WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
      `
      if (userMembership.length === 0 || userMembership[0].role !== "PARENT") {
        return NextResponse.json(
          { success: false, error: "Only parents can remove other members" },
          { status: 403 }
        )
      }
    }

    if (member.role === "CHILD") {
      // A child's data is deleted, not just hidden: their profile (name,
      // birthdate, school, notes), location settings and, if this was their
      // only family, their login.
      await deleteChildData({ familyId, childMemberId: memberId, closeAccount: "if-no-other-family" })
    } else {
      // Soft delete member
      await sql`
        UPDATE family_members
        SET is_active = false, updated_at = NOW()
        WHERE id = ${memberId}
      `
    }

    // When someone is removed by an admin, rotate the invite code so they
    // can't simply walk back in with the code they already have. (Leaving on
    // your own doesn't rotate it.)
    let inviteCodeRotated = false
    if (!isSelf) {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
      let newCode = ""
      for (let i = 0; i < 8; i++) {
        newCode += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7)
      await sql`
        UPDATE families
        SET invite_code = ${newCode}, invite_expires_at = ${expiresAt.toISOString()}, updated_at = NOW()
        WHERE id = ${familyId}
      `
      inviteCodeRotated = true
    }

    // Audit log
    await logAuditEvent(user.id, "DELETE", "family_member", memberId, {
      metadata: { targetUserId: member.user_id, isSelf, inviteCodeRotated },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: isSelf ? "You have left the family" : "Member removed successfully",
      inviteCodeRotated,
    })
  } catch (error) {
    console.error("Remove member error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to remove member" },
      { status: 500 }
    )
  }
}
