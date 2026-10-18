import { assignDefaultAppearance } from "@/lib/member-appearance"
import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, hashPassword, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { getTierDefinition } from "@/lib/subscription-tiers"
import { ensureAgeColumns } from "@/lib/age-schema"
import { ageFromDob, dobError, childAgeInfo, GUEST_AGE_INFO } from "@/lib/age"

const addChildSchema = z.object({
  displayName: z.string().min(1, "Display name is required").max(100),
  age: z.number().int().min(0).max(25).optional(),
  // YYYY-MM-DD. When sent, it wins over `age` and the age is derived from it.
  dateOfBirth: z.string().optional().nullable(),
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

    // A guest doesn't get the family's children at all (not even names).
    if (membership[0].role === "GUEST") {
      return NextResponse.json({ success: true, data: [] })
    }

    // Get children
    await ensureAgeColumns()
    const children = await sql`
      SELECT
        cp.id, cp.display_name, cp.age, cp.school, cp.grade,
        cp.emergency_notes, cp.avatar_url, cp.created_at,
        to_char(cp.date_of_birth, 'YYYY-MM-DD') AS dob, cp.adult_prompt_snoozed_until,
        fm.id as member_id, fm.user_id, fm.role, fm.can_create_events,
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

    // Guests never see children's birthdates, ages, school, grade or emergency notes.
    const viewerIsGuest = membership[0].role === "GUEST"
    return NextResponse.json({
      success: true,
      data: children.map((c) => ({
        id: c.id,
        memberId: c.member_id,
        userId: c.user_id,
        displayName: c.display_name,
        // dateOfBirth, age (derived from the birthdate when known),
        // canHaveAccount, turns18On, daysUntil18, needsRoleChoice
        ...(viewerIsGuest
          ? GUEST_AGE_INFO
          : childAgeInfo({ dob: c.dob, age: c.age, role: c.role, userId: c.user_id, snoozedUntil: c.adult_prompt_snoozed_until })),
        school: viewerIsGuest ? null : c.school,
        grade: viewerIsGuest ? null : c.grade,
        emergencyNotes: membership[0].role === "PARENT" ? c.emergency_notes : null,
        avatarUrl: c.avatar_url,
        hasAccount: !!c.email,
        email: membership[0].role === "PARENT" ? c.email : null,
        permissions: {
          canCreateEvents: c.can_create_events,
          requiresEventApproval: c.requires_event_approval,
          canOverrideConflicts: c.can_override_conflicts,
        },
        // Guests never receive family location data.
        location: membership[0].role === "GUEST"
          ? { mode: "OFF", sharingEnabled: false }
          : {
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

    // A birthdate wins over a plain age; the stored age is derived from it so
    // screens that still read child_profiles.age keep working.
    const dob = validatedData.dateOfBirth || null
    if (dob) {
      const bad = dobError(dob)
      if (bad) return NextResponse.json({ success: false, error: bad }, { status: 400 })
    }
    const storedAge = dob ? ageFromDob(dob) : validatedData.age ?? null
    await ensureAgeColumns()

    // Check subscription limits - count only children
    const subscription = await checkFamilySubscription(familyId)
    const childCount = await sql`
      SELECT COUNT(*) as count FROM family_members 
      WHERE family_id = ${familyId} AND is_active = true AND role = 'CHILD'
    `

    // maxChildren: FREE=2, PREMIUM (Plus)=5, PREMIUM_PLUS (Premium)=-1 (unlimited)
    const maxChildren = subscription.features.maxChildren
    const currentChildren = Number(childCount[0].count)
    
    if (maxChildren !== -1 && currentChildren >= maxChildren) {
      const tierName = getTierDefinition(subscription.tier).name // Free / Plus / Premium
      return NextResponse.json(
        { 
          success: false, 
          error: `${tierName} plan allows up to ${maxChildren} children. Upgrade to add more.` 
        },
        { status: 400 }
      )
    }

    // Children count only against the plan's child limit above ("Up to 5
    // children" on Plus); the family-member cap is for the other members, so
    // a two-parent Plus family can really add 5 children.

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

      // Never turn the family owner or a parent/guardian into a child (that
      // would strip their rights); member edits already protect the owner.
      const ownerRow = await sql`SELECT owner_id FROM families WHERE id = ${familyId}`
      if (existingMember[0].user_id === ownerRow[0]?.owner_id || ['PARENT', 'GUARDIAN'].includes(existingMember[0].role)) {
        return NextResponse.json(
          { success: false, error: "The family owner and parents can't be turned into a child profile" },
          { status: 403 }
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
          id, family_member_id, display_name, age, date_of_birth, school, grade,
          emergency_notes, created_at, updated_at
        )
        VALUES (
          ${profileId}, ${memberId}, ${validatedData.displayName},
          ${storedAge}, ${dob}, ${validatedData.school || null},
          ${validatedData.grade || null}, ${validatedData.emergencyNotes || null},
          NOW(), NOW()
        )
      `

      await assignDefaultAppearance(memberId)

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
        id, family_member_id, display_name, age, date_of_birth, school, grade,
        emergency_notes, created_at, updated_at
      )
      VALUES (
        ${profileId}, ${memberId}, ${validatedData.displayName},
        ${storedAge}, ${dob}, ${validatedData.school || null},
        ${validatedData.grade || null}, ${validatedData.emergencyNotes || null},
        NOW(), NOW()
      )
    `

    await assignDefaultAppearance(memberId)

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
