import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"

// Note: users table uses profile_photo_url column, not avatar_url
import { z } from "zod"

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
            u.profile_photo_url
          FROM family_members fm
          LEFT JOIN users u ON fm.user_id = u.id
          WHERE fm.family_id = ${f.id} AND fm.is_active = true
          ORDER BY fm.joined_at ASC
        `
        
        // Also fetch children for each family
        const children = await sql`
          SELECT 
            cp.id, cp.display_name, cp.age, cp.school, cp.grade,
            cp.avatar_url, cp.created_at
          FROM child_profiles cp
          JOIN family_members fm ON cp.family_member_id = fm.id
          WHERE fm.family_id = ${f.id}
        `
        
        return {
          id: f.id,
          name: f.name,
          ownerId: f.owner_id,
          isOwner: f.owner_id === user.id,
          inviteCode: f.owner_id === user.id ? f.invite_code : null,
          inviteExpiresAt: f.invite_expires_at,
          userRole: f.user_role,
          currentUserRole: f.user_role,
          membershipId: f.membership_id,
          memberCount: Number(f.member_count),
          members: members.map((m) => ({
            id: m.id,
            userId: m.user_id,
            role: m.role,
            displayName: m.nickname || `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown',
            avatarUrl: m.profile_photo_url,
            isActive: m.is_active,
            joinedAt: m.joined_at,
          })),
          children: children.map((c) => ({
            id: c.id,
            displayName: c.display_name,
            avatarUrl: c.avatar_url,
            grade: c.grade,
            age: c.age,
            school: c.school,
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

    // Check if user already owns a family
    const existingFamilies = await sql`
      SELECT id FROM families WHERE owner_id = ${user.id}
    `

    if (existingFamilies.length > 0) {
      return NextResponse.json(
        { success: false, error: "You already own a family. You can only own one family." },
        { status: 400 }
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

    // Every new family starts on a 14-day free Premium trial, no card needed.
    // When it ends the cron job (app/api/cron/reminders) drops the family to
    // Free, and the owner can subscribe from the Subscription page. A user can
    // only own one family, so this is one trial per owner. If the insert
    // fails the family is still created on the Free plan.
    const subscriptionId = crypto.randomUUID()
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
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
            'SYSTEM', '14-day PREMIUM_PLUS trial started automatically at sign-up', NOW()
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
      message: trialStarted ? "Family created. Your 14-day free trial has started." : "Family created successfully",
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
