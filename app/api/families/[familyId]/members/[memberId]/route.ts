import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"

const updateMemberSchema = z.object({
  role: z.enum(["PARENT", "GUARDIAN", "CHILD"]).optional(),
  nickname: z.string().max(50).optional(),
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

    if (userMembership.length === 0 || userMembership[0].role !== "PARENT") {
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

    // Build update
    await sql`
      UPDATE family_members 
      SET 
        role = COALESCE(${validatedData.role}, role),
        nickname = COALESCE(${validatedData.nickname}, nickname),
        can_create_events = COALESCE(${validatedData.canCreateEvents}, can_create_events),
        requires_event_approval = COALESCE(${validatedData.requiresEventApproval}, requires_event_approval),
        can_override_conflicts = COALESCE(${validatedData.canOverrideConflicts}, can_override_conflicts),
        can_view_family_calendar = COALESCE(${validatedData.canViewFamilyCalendar}, can_view_family_calendar),
        can_invite_members = COALESCE(${validatedData.canInviteMembers}, can_invite_members),
        updated_at = NOW()
      WHERE id = ${memberId}
    `

    // If role changed to CHILD, ensure child profile exists
    if (validatedData.role === "CHILD") {
      const existingProfile = await sql`
        SELECT id FROM child_profiles WHERE family_member_id = ${memberId}
      `
      if (existingProfile.length === 0) {
        await sql`
          INSERT INTO child_profiles (id, family_member_id, display_name, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${memberId}, ${validatedData.nickname || 'Child'}, NOW(), NOW())
        `
      }
    }

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

    // Soft delete member
    await sql`
      UPDATE family_members 
      SET is_active = false, updated_at = NOW()
      WHERE id = ${memberId}
    `

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
