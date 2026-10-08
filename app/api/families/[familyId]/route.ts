import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { ensureMemberAppearanceColumns } from "@/lib/member-appearance"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"

const updateFamilySchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

// Get family details with members
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  try {
    const { familyId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Get family
    const families = await sql`
      SELECT 
        f.id, f.name, f.owner_id, f.invite_code, f.invite_expires_at, f.created_at,
        s.tier as subscription_tier, s.status as subscription_status
      FROM families f
      LEFT JOIN subscriptions s ON f.id = s.family_id AND s.status IN ('ACTIVE', 'TRIALING')
      WHERE f.id = ${familyId}
    `

    if (families.length === 0) {
      return NextResponse.json(
        { success: false, error: "Family not found" },
        { status: 404 }
      )
    }

    const family = families[0]
    const isOwner = family.owner_id === user.id

    // SECURITY FIX: this endpoint previously returned any family's full
    // member list and children's data (including school/grade) to *any*
    // authenticated user, not just members of that family. Enforce membership.
    if (!isOwner) {
      const membership = await sql`
        SELECT 1 FROM family_members
        WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
      `
      if (membership.length === 0) {
        return NextResponse.json(
          { success: false, error: "Family not found" },
          { status: 404 }
        )
      }
    }

    await ensureMemberAppearanceColumns()

    // Get members
    const members = await sql`
      SELECT 
        fm.id, fm.user_id, fm.role, fm.nickname, fm.is_active, fm.joined_at,
        fm.can_create_events, fm.requires_event_approval, fm.can_override_conflicts,
        fm.can_view_family_calendar, fm.can_invite_members, fm.color, fm.emoji,
        u.email, u.first_name, u.last_name, u.profile_photo_path,
        cp.id as child_profile_id, cp.display_name, cp.age, cp.school, cp.grade
      FROM family_members fm
      JOIN users u ON fm.user_id = u.id
      LEFT JOIN child_profiles cp ON fm.id = cp.family_member_id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true
      ORDER BY fm.role = 'PARENT' DESC, fm.joined_at ASC
    `

    // Get children (separate from members)
    const children = await sql`
      SELECT 
        cp.id, cp.display_name, cp.age, cp.school, cp.grade,
        cp.avatar_url, cp.created_at,
        fm.id as family_member_id, fm.color, fm.emoji
      FROM child_profiles cp
      JOIN family_members fm ON cp.family_member_id = fm.id
      WHERE fm.family_id = ${familyId}
    `

    // Return { family } for SWR hook compatibility
    return NextResponse.json({
      family: {
        id: family.id,
        name: family.name,
        ownerId: family.owner_id,
        isOwner,
        inviteCode: isOwner ? family.invite_code : null,
        inviteExpiresAt: family.invite_expires_at,
        subscription: {
          tier: family.subscription_tier || "FREE",
          status: family.subscription_status || "ACTIVE",
        },
        createdAt: family.created_at,
        members: members.map((m) => ({
          id: m.id,
          userId: m.user_id,
          familyId: familyId,
          role: m.role,
          displayName: m.nickname || [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown',
          avatarUrl: m.profile_photo_path,
          color: m.color || null,
          emoji: m.emoji || null,
          isActive: m.is_active,
          joinedAt: m.joined_at,
          permissions: {
            canCreateEvents: m.can_create_events,
            requiresEventApproval: m.requires_event_approval,
            canOverrideConflicts: m.can_override_conflicts,
            canViewFamilyCalendar: m.can_view_family_calendar,
            canInviteMembers: m.can_invite_members,
          },
        })),
        children: children.map((c) => ({
          id: c.id,
          familyId: familyId,
          displayName: c.display_name,
          birthDate: null,
          avatarUrl: c.avatar_url,
          familyMemberId: c.family_member_id,
          color: c.color || null,
          emoji: c.emoji || null,
          grade: c.grade,
          permissions: {
            canCreateEvents: false,
            requiresApproval: true,
            canViewFamilyCalendar: true,
            locationSharingEnabled: false,
          },
          createdAt: c.created_at,
        })),
      },
    })
  } catch (error) {
    console.error("Get family error:", error)
    const message = error instanceof Error ? error.message : "Failed to get family"
    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof Error && error.message.includes("member") ? 403 : 500 }
    )
  }
}

// Update family (owner only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  try {
    const { familyId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Verify ownership
    const families = await sql`
      SELECT owner_id FROM families WHERE id = ${familyId}
    `

    if (families.length === 0) {
      return NextResponse.json(
        { success: false, error: "Family not found" },
        { status: 404 }
      )
    }

    if (families[0].owner_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "Only the family owner can update family settings" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name } = updateFamilySchema.parse(body)

    if (name) {
      await sql`
        UPDATE families 
        SET name = ${name}, updated_at = NOW()
        WHERE id = ${familyId}
      `
    }

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "family", familyId, {
      newValue: { name },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Family updated successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Update family error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update family" },
      { status: 500 }
    )
  }
}

// Delete family (owner only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  try {
    const { familyId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Verify ownership
    const families = await sql`
      SELECT owner_id, name FROM families WHERE id = ${familyId}
    `

    if (families.length === 0) {
      return NextResponse.json(
        { success: false, error: "Family not found" },
        { status: 404 }
      )
    }

    if (families[0].owner_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "Only the family owner can delete the family" },
        { status: 403 }
      )
    }

    // Soft delete - deactivate all members and mark family
    await sql`
      UPDATE family_members 
      SET is_active = false, updated_at = NOW()
      WHERE family_id = ${familyId}
    `

    // Cancel any active subscriptions
    await sql`
      UPDATE subscriptions 
      SET status = 'CANCELLED', updated_at = NOW()
      WHERE family_id = ${familyId} AND status IN ('ACTIVE', 'TRIALING')
    `

    // Audit log
    await logAuditEvent(user.id, "DELETE", "family", familyId, {
      oldValue: { name: families[0].name },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Family deleted successfully",
    })
  } catch (error) {
    console.error("Delete family error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to delete family" },
      { status: 500 }
    )
  }
}
