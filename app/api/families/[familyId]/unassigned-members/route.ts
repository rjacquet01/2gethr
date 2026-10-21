import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { memberName } from "@/lib/member-names"

// Get family members who don't have a child profile assigned yet
// These are users who joined via invite code but haven't been set up as children
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

    // Verify user is a parent in this family
    const membership = await sql`
      SELECT role FROM family_members 
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json(
        { success: false, error: "Not a member of this family" },
        { status: 403 }
      )
    }

    if (membership[0].role !== 'PARENT') {
      return NextResponse.json(
        { success: false, error: "Only parents can view unassigned members" },
        { status: 403 }
      )
    }

    // Get members who:
    // 1. Are active in this family
    // 2. Are NOT already set as CHILD role (they might have joined as PARENT/GUARDIAN but want to be reassigned)
    // 3. OR are CHILD role but don't have a child_profile yet
    // This gives parents flexibility to assign any member as a child if needed
    const unassignedMembers = await sql`
      SELECT 
        fm.id as member_id,
        fm.user_id,
        fm.role,
        fm.nickname,
        fm.joined_at,
        u.email,
        u.first_name,
        u.last_name,
        u.profile_photo_url
      FROM family_members fm
      JOIN users u ON fm.user_id = u.id
      LEFT JOIN child_profiles cp ON fm.id = cp.family_member_id
      WHERE fm.family_id = ${familyId} 
        AND fm.is_active = true 
        AND cp.id IS NULL
        AND fm.user_id != ${user.id}
      ORDER BY fm.joined_at DESC
    `

    return NextResponse.json({
      success: true,
      data: unassignedMembers.map((m) => ({
        memberId: m.member_id,
        userId: m.user_id,
        currentRole: m.role,
        nickname: m.nickname,
        email: m.email,
        firstName: m.first_name,
        lastName: m.last_name,
        displayName: memberName({ role: m.role, nickname: m.nickname, firstName: m.first_name, lastName: m.last_name }, { withLastName: true, fallback: m.email }),
        avatarUrl: m.profile_photo_url,
        joinedAt: m.joined_at,
      })),
    })
  } catch (error) {
    console.error("Get unassigned members error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get unassigned members" },
      { status: 500 }
    )
  }
}
