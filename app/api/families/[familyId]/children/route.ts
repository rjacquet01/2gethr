import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, hashPassword, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { z } from "zod"

const addChildSchema = z.object({
  displayName: z.string().min(1, "Display name is required").max(100),
  age: z.number().int().min(0).max(25).optional(),
  school: z.string().max(200).optional(),
  grade: z.string().max(50).optional(),
  emergencyNotes: z.string().max(1000).optional(),
  // If creating a user account for the child
  createAccount: z.boolean().default(false),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  // If assigning an existing family member as a child
  existingMemberId: z.string().uuid().optional(),
})

// Get children in family
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

    // Verify user is a member
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

    // Get children
    const children = await sql`
      SELECT 
        cp.id, cp.display_name, cp.age, cp.school, cp.grade, 
        cp.emergency_notes, cp.avatar_url, cp.created_at,
        fm.id as member_id, fm.user_id, fm.can_create_events,
        fm.requires_event_approval, fm.can_override_conflicts,
        u.email, u.first_name, u.last_name,
        ls.mode as location_mode, ls.share_with_family as location_sharing
      FROM child_profiles cp
      JOIN family_members fm ON cp.family_member_id = fm.id
      LEFT JOIN users u ON fm.user_id = u.id
      LEFT JOIN location_settings ls ON fm.id = ls.family_member_id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true AND fm.role = 'CHILD'
      ORDER BY cp.display_name ASC
    `

    return NextResponse.json({
      success: true,
      data: children.map((c) => ({
        id: c.id,
        memberId: c.member_id,
        userId: c.user_id,
        displayName: c.display_name,
        age: c.age,
        school: c.school,
        grade: c.grade,
        emergencyNotes: membership[0].role === "PARENT" ? c.emergency_notes : null,
        avatarUrl: c.avatar_url,
        hasAccount: !!c.email,
        email: membership[0].role === "PARENT" ? c.email : null,
        permissions: {
          canCreateEvents: c.can_create_events,
          requiresEventApproval: c.requires_event_approval,
          canOverrideConflicts: c.can_override_conflicts,
        },
        location: {
          mode: c.location_mode || "OFF",
          sharingEnabled: c.location_sharing || false,
        },
        createdAt: c.created_at,
      })),
    })
  } catch (error) {
    console.error("Get children error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get children" },
      { status: 500 }
    )
  }
}

// Add child to family (parent only)
export async function POST(
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

    // Verify user is a PARENT
    const membership = await sql`
      SELECT role FROM family_members 
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0 || membership[0].role !== "PARENT") {
      return NextResponse.json(
        { success: false, error: "Only parents can add children" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = addChildSchema.parse(body)

    // Check subscription limits - count only children
    const subscription = await checkFamilySubscription(familyId)
    const childCount = await sql`
      SELECT COUNT(*) as count FROM family_members 
      WHERE family_id = ${familyId} AND is_active = true AND role = 'CHILD'
    `

    // maxChildren: FREE=2, PREMIUM (Basic)=5, PREMIUM_PLUS (Premium)=-1 (unlimited)
    const maxChildren = subscription.features.maxChildren
    const currentChildren = Number(childCount[0].count)
    
    if (maxChildren !== -1 && currentChildren >= maxChildren) {
      const tierName = subscription.tier === 'FREE' ? 'Free' : subscription.tier === 'PREMIUM' ? 'Basic' : 'Premium'
      return NextResponse.json(
        { 
          success: false, 
          error: `${tierName} plan allows up to ${maxChildren} children. Upgrade to add more.` 
        },
        { status: 400 }
      )
    }

    // A brand-new child account also takes a seat, so it counts against the
    // plan's family-member cap (Free 4, Basic 6, Premium 12). Assigning an
    // existing member as a child does not add a seat.
    if (!validatedData.existingMemberId) {
      const maxMembers = subscription.features.maxFamilyMembers
      const memberCount = await sql`
        SELECT COUNT(*) as count FROM family_members
        WHERE family_id = ${familyId} AND is_active = true
      `
      if (maxMembers !== -1 && Number(memberCount[0].count) >= maxMembers) {
        const tierName = subscription.tier === 'FREE' ? 'Free' : subscription.tier === 'PREMIUM' ? 'Basic' : 'Premium'
        return NextResponse.json(
          {
            success: false,
            error: `${tierName} plan allows up to ${maxMembers} family members. Upgrade to add more.`
          },
          { status: 400 }
        )
      }
    }

    let userId: string | null = null
    let memberId: string

    // If assigning an existing family member as a child
    if (validatedData.existingMemberId) {
      // Verify the member exists in this family and doesn't have a child profile
      const existingMember = await sql`
        SELECT fm.id, fm.user_id, fm.role, u.first_name, u.last_name
        FROM family_members fm
        JOIN users u ON fm.user_id = u.id
        LEFT JOIN child_profiles cp ON fm.id = cp.family_member_id
        WHERE fm.id = ${validatedData.existingMemberId} 
          AND fm.family_id = ${familyId}
          AND fm.is_active = true
          AND cp.id IS NULL
      `

      if (existingMember.length === 0) {
        return NextResponse.json(
          { success: false, error: "Member not found or already has a child profile" },
          { status: 404 }
        )
      }

      memberId = validatedData.existingMemberId
      userId = existingMember[0].user_id

      // Update member role to CHILD and adjust permissions
      await sql`
        UPDATE family_members 
        SET role = 'CHILD', 
            nickname = ${validatedData.displayName},
            can_create_events = false,
            requires_event_approval = true,
            can_override_conflicts = false,
            can_invite_members = false,
            updated_at = NOW()
        WHERE id = ${memberId}
      `

      // Create child profile for existing member
      const profileId = crypto.randomUUID()
      await sql`
        INSERT INTO child_profiles (
          id, family_member_id, display_name, age, school, grade, 
          emergency_notes, created_at, updated_at
        )
        VALUES (
          ${profileId}, ${memberId}, ${validatedData.displayName}, 
          ${validatedData.age || null}, ${validatedData.school || null}, 
          ${validatedData.grade || null}, ${validatedData.emergencyNotes || null},
          NOW(), NOW()
        )
      `

      // Create location settings if they don't exist
      const existingLocationSettings = await sql`
        SELECT id FROM location_settings WHERE family_member_id = ${memberId}
      `
      if (existingLocationSettings.length === 0) {
        await sql`
          INSERT INTO location_settings (
            id, family_member_id, mode, share_with_family, 
            update_interval_sec, created_at, updated_at
          )
          VALUES (
            ${crypto.randomUUID()}, ${memberId}, 'OFF', false, 
            300, NOW(), NOW()
          )
        `
      }

      // Audit log
      await logAuditEvent(user.id, "UPDATE", "family_member_to_child", memberId, {
        newValue: { 
          displayName: validatedData.displayName,
          previousRole: existingMember[0].role,
        },
        ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      })

      return NextResponse.json({
        success: true,
        data: {
          id: profileId,
          memberId,
          displayName: validatedData.displayName,
          hasAccount: true,
        },
        message: "Member assigned as child successfully",
      })
    }

    // Create user account if requested
    if (validatedData.createAccount && validatedData.email && validatedData.password) {
      // Check if email already exists
      const existingUser = await sql`
        SELECT id FROM users WHERE email = ${validatedData.email.toLowerCase()}
      `

      if (existingUser.length > 0) {
        return NextResponse.json(
          { success: false, error: "Email already registered" },
          { status: 409 }
        )
      }

      userId = crypto.randomUUID()
      const passwordHash = await hashPassword(validatedData.password)

      await sql`
        INSERT INTO users (
          id, email, password_hash, first_name, last_name,
          is_active, created_at, updated_at
        )
        VALUES (
          ${userId}, ${validatedData.email.toLowerCase()}, ${passwordHash},
          ${validatedData.displayName}, '', true, NOW(), NOW()
        )
      `
    }

    // Create family member
    memberId = crypto.randomUUID()
    await sql`
      INSERT INTO family_members (
        id, family_id, user_id, role, nickname, is_active, joined_at,
        can_create_events, requires_event_approval, can_override_conflicts,
        can_view_family_calendar, can_invite_members, created_at, updated_at
      )
      VALUES (
        ${memberId}, ${familyId}, ${userId}, 'CHILD', ${validatedData.displayName},
        true, NOW(), false, true, false, true, false, NOW(), NOW()
      )
    `

    // Create child profile
    const profileId = crypto.randomUUID()
    await sql`
      INSERT INTO child_profiles (
        id, family_member_id, display_name, age, school, grade, 
        emergency_notes, created_at, updated_at
      )
      VALUES (
        ${profileId}, ${memberId}, ${validatedData.displayName}, 
        ${validatedData.age || null}, ${validatedData.school || null}, 
        ${validatedData.grade || null}, ${validatedData.emergencyNotes || null},
        NOW(), NOW()
      )
    `

    // Create location settings
    await sql`
      INSERT INTO location_settings (
        id, family_member_id, mode, share_with_family, 
        update_interval_sec, created_at, updated_at
      )
      VALUES (
        ${crypto.randomUUID()}, ${memberId}, 'OFF', false, 
        300, NOW(), NOW()
      )
    `

    // Audit log
    await logAuditEvent(user.id, "CREATE", "child_profile", profileId, {
      newValue: { displayName: validatedData.displayName, familyId },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      data: {
        id: profileId,
        memberId,
        userId,
        displayName: validatedData.displayName,
      },
      message: "Child added successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Add child error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to add child" },
      { status: 500 }
    )
  }
}
