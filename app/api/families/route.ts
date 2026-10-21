import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"

// Note: users table uses profile_photo_url column, not avatar_url
import { z } from "zod"
import { TRIAL_DAYS } from "@/lib/subscription-tiers"
import { memberName } from "@/lib/member-names"

const createFamilySchema = z.object({
  name: z.string().min(1, "Family name is required").max(100),
})

// Get user's families
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const families = await sql`
      SELECT 
        f.id,
        f.name,
        f.owner_id,
        f.invite_code,
        f.invite_expires_at,
        f.created_at,
        fm.role as user_role,
        fm.id as membership_id,
        (SELECT COUNT(*) FROM family_members WHERE family_id = f.id AND is_active = true) as member_count,
        s.tier as subscription_tier,
        s.status as subscription_status
      FROM families f
      JOIN family_members fm ON f.id = fm.family_id
      LEFT JOIN subscriptions s ON f.id = s.family_id AND s.status IN ('ACTIVE', 'TRIALING')
      WHERE fm.user_id = ${user.id} AND fm.is_active = true
      ORDER BY (f.owner_id = ${user.id}) DESC, fm.joined_at ASC
    `

    // Fetch members and children for each family to display on dashboard
    const familiesWithMembers = await Promise.all(
      families.map(async (f) => {
        const members = await sql`
          SELECT 
            fm.id,
            fm.user_id,
            fm.role,
            fm.nickname,
            fm.is_active,
            fm.joined_at,
            u.first_name,
            u.last_name,
            u.profile_photo_url,
            cp.display_name
          FROM family_members fm
          LEFT JOIN users u ON fm.user_id = u.id
          LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
          WHERE fm.family_id = ${f.id} AND fm.is_active = true
            -- A guest sees only their own membership, never the family's structure.
            AND (${f.user_role} <> 'GUEST' OR fm.user_id = ${user.id})
          ORDER BY fm.joined_at ASC
        `
        
        // Also fetch children for each family (none for a guest)
        const children = f.user_role === 'GUEST' ? [] : await sql`
          SELECT 
            cp.id, cp.display_name, cp.age, cp.school, cp.grade,
            cp.avatar_url, cp.created_at, fm.user_id AS member_user_id
          FROM child_profiles cp
          JOIN family_members fm ON cp.family_member_id = fm.id
          WHERE fm.family_id = ${f.id} AND fm.role = 'CHILD' AND fm.is_active = true
        `
        
        return {
          id: f.id,
          name: f.name,
          // A guest gets the family name and their own membership only: no owner,
          // member count, invite details, members or children.
          ownerId: f.user_role === 'GUEST' ? null : f.owner_id,
          isOwner: f.owner_id === user.id,
          inviteCode: f.owner_id === user.id ? f.invite_code : null,
          inviteExpiresAt: f.user_role === 'GUEST' ? null : f.invite_expires_at,
          userRole: f.user_role,
          currentUserRole: f.user_role,
          membershipId: f.membership_id,
          memberCount: f.user_role === 'GUEST' ? null : Number(f.member_count),
          members: members.map((m) => ({
            id: m.id,
            userId: m.user_id,
            role: m.role,
            displayName: memberName({ role: m.role, nickname: m.nickname, childDisplayName: m.display_name, firstName: m.first_name, lastName: m.last_name }, { withLastName: true }),
            avatarUrl: m.profile_photo_url,
            // false for a child managed by a parent (no login, user_id NULL)
            hasAccount: !!m.user_id,
            isActive: m.is_active,
            joinedAt: m.joined_at,
          })),
          // Guests never see children's age, school or grade.
          children: children.map((c) => ({
            id: c.id,
            displayName: c.display_name,
            avatarUrl: c.avatar_url,
            grade: f.user_role === 'GUEST' ? null : c.grade,
            age: f.user_role === 'GUEST' ? null : c.age,
            school: f.user_role === 'GUEST' ? null : c.school,
            hasAccount: !!c.member_user_id,
            // This child profile is the signed-in user's own (a child's login).
            isMe: !!c.member_user_id && c.member_user_id === user!.id,
            createdAt: c.created_at,
          })),
          subscription: {
            tier: f.subscription_tier || "FREE",
            status: f.subscription_status || "ACTIVE",
          },
          createdAt: f.created_at,
        }
      })
    )

    // Return { families } for SWR hook compatibility
    return NextResponse.json({
      families: familiesWithMembers,
    })
  } catch (error) {
    console.error("Get families error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get families" },
      { status: 500 }
    )
  }
}

// Create a new family
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { name } = createFamilySchema.parse(body)

    // Check if user already owns a family. Deleting a family is a soft delete
    // (memberships deactivated, the families row kept), so only a family the
    // owner is still an active member of counts. The one-trial-per-owner
    // check below still looks at every family they ever owned.
    const existingFamilies = await sql`
      SELECT f.id FROM families f
      JOIN family_members fm ON fm.family_id = f.id AND fm.user_id = f.owner_id AND fm.is_active = true
      WHERE f.owner_id = ${user.id}
    `

    if (existingFamilies.length > 0) {
      return NextResponse.json(
        { success: false, error: "You already own a family. You can only own one family." },
        { status: 400 }
      )
    }

    // A child member can't start a family of their own. Anyone else may,
    // including a guest or adult in someone else's family (they keep that
    // membership and its role; the new family is separate).
    const memberships = await sql`
      SELECT role FROM family_members WHERE user_id = ${user.id} AND is_active = true
    `
    if (memberships.length > 0 && memberships.every((m) => m.role === "CHILD")) {
      return NextResponse.json(
        {
          success: false,
          error: "Child members can't create their own family. Ask a parent if you need a change to your account.",
        },
        { status: 403 }
      )
    }

    const familyId = crypto.randomUUID()
    const memberId = crypto.randomUUID()
    const inviteCode = generateInviteCode()
    const inviteExpiresAt = new Date()
    inviteExpiresAt.setDate(inviteExpiresAt.getDate() + 7)

    // Create family
    await sql`
      INSERT INTO families (id, name, owner_id, invite_code, invite_expires_at, created_at, updated_at)
      VALUES (${familyId}, ${name}, ${user.id}, ${inviteCode}, ${inviteExpiresAt.toISOString()}, NOW(), NOW())
    `

    // Add owner as PARENT member
    await sql`
      INSERT INTO family_members (
        id, family_id, user_id, role, nickname, is_active, joined_at,
        can_create_events, requires_event_approval, can_override_conflicts,
        can_view_family_calendar, can_invite_members, created_at, updated_at
      )
      VALUES (
        ${memberId}, ${familyId}, ${user.id}, 'PARENT', ${user.firstName},
        true, NOW(), true, false, true, true, true, NOW(), NOW()
      )
    `

    // Create default family calendar
    const calendarId = crypto.randomUUID()
    await sql`
      INSERT INTO calendars (id, family_id, name, color, is_shared, is_default, created_at, updated_at)
      VALUES (${calendarId}, ${familyId}, 'Family Calendar', '#3B82F6', true, true, NOW(), NOW())
    `

    // Every new family starts on a TRIAL_DAYS-day free Premium trial, no card needed.
    // When it ends the cron job (app/api/cron/reminders) drops the family to
    // Free, and the owner can subscribe from the Subscription page. A user can
    // only own one family, so this is one trial per owner. If the insert
    // fails the family is still created on the Free plan.
    const subscriptionId = crypto.randomUUID()
    const trialEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
    let trialStarted = false
    try {
      const priorTrial = await sql`
        SELECT 1 FROM subscriptions s
        JOIN families f ON f.id = s.family_id
        WHERE f.owner_id = ${user.id} AND s.trial_ends_at IS NOT NULL
        LIMIT 1
      `
      if (priorTrial.length === 0) {
        await sql`
          INSERT INTO subscriptions (
            id, family_id, tier, status, trial_ends_at,
            current_period_start, current_period_end,
            created_at, updated_at
          )
          VALUES (
            ${subscriptionId}, ${familyId}, 'PREMIUM_PLUS', 'TRIALING', ${trialEnd.toISOString()},
            NOW(), ${trialEnd.toISOString()}, NOW(), NOW()
          )
        `
        await sql`
          INSERT INTO subscription_status_history (
            id, subscription_id, old_status, new_status, source, notes, changed_at
          ) VALUES (
            gen_random_uuid(), ${subscriptionId}, 'NONE', 'TRIALING',
            'SYSTEM', ${`${TRIAL_DAYS}-day PREMIUM_PLUS trial started automatically at sign-up`}, NOW()
          )
        `
        trialStarted = true
      }
    } catch (trialError) {
      console.error("Auto-trial failed, falling back to Free plan:", trialError)
    }

    if (!trialStarted) {
      await sql`
        INSERT INTO subscriptions (
          id, family_id, tier, status,
          current_period_start, current_period_end,
          created_at, updated_at
        )
        VALUES (
          ${crypto.randomUUID()}, ${familyId}, 'FREE', 'ACTIVE',
          NOW(), ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()},
          NOW(), NOW()
        )
      `
    }

    // Audit log
    await logAuditEvent(user.id, "CREATE", "family", familyId, {
      newValue: { name, ownerId: user.id },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      data: {
        id: familyId,
        name,
        ownerId: user.id,
        inviteCode,
        inviteExpiresAt,
        membershipId: memberId,
        calendarId,
      },
      trialStarted,
      message: trialStarted ? `Family created. Your ${TRIAL_DAYS}-day free trial has started.` : "Family created successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Create family error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create family" },
      { status: 500 }
    )
  }
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}
