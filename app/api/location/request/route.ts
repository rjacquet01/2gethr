import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription } from "@/lib/auth"
import { z } from "zod"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { APPROVAL_WINDOW_MINUTES, PING_WINDOW_MINUTES, PING_LIMIT_ADULT, PING_LIMIT_CHILD, sendApprovalRequest } from "@/lib/location-approval"

const requestLocationSchema = z.object({
  memberId: z.string().min(1, "Member ID is required"),
  familyId: z.string().min(1, "Family ID is required"),
})

// Request immediate location update from a family member
// This creates a pending request that the member's device should respond to
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    await ensureLocationRequestsTable()
    const body = await request.json()
    const validatedData = requestLocationSchema.parse(body)

    // Verify the requester belongs to this family and get target member info
    const membership = await sql`
      SELECT 
        fm.role, 
        fm.user_id as requester_user_id,
        target.id as target_member_id,
        target.user_id as target_user_id, 
        target.nickname as target_name
      FROM family_members fm
      JOIN family_members target ON fm.family_id = target.family_id AND target.id = ${validatedData.memberId}
      WHERE fm.family_id = ${validatedData.familyId} 
        AND fm.user_id = ${user.id} 
        AND fm.is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member not found or not in this family" },
        { status: 404 }
      )
    }

    // Any active family member may ask any other member for a one-time location;
    // the recipient must approve before anything is shared.

    // Prevent pinging yourself
    if (membership[0].target_user_id === user.id) {
      return NextResponse.json(
        { success: false, error: "You cannot ping your own location" },
        { status: 400 }
      )
    }

    // Ensure target member has a linked user account
    if (!membership[0].target_user_id) {
      return NextResponse.json(
        { success: false, error: "This family member does not have a linked account to receive location requests" },
        { status: 400 }
      )
    }

    // Check subscription allows location sharing
    const subscription = await checkFamilySubscription(validatedData.familyId)
    if (!subscription.features.locationSharing) {
      return NextResponse.json(
        { success: false, error: "Location sharing requires a Premium subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      )
    }

    // Limit pings per person per hour: parents/guardians 5, children 2.
    const requesterRole = membership[0].role as string
    const limit = ["PARENT", "GUARDIAN", "ADMIN"].includes(requesterRole) ? PING_LIMIT_ADULT : PING_LIMIT_CHILD
    const recent = await sql`
      SELECT created_at FROM location_requests
      WHERE requester_user_id = ${user.id} AND target_user_id = ${membership[0].target_user_id}
        AND created_at > NOW() - make_interval(mins => ${PING_WINDOW_MINUTES}::int)
      ORDER BY created_at ASC
    `
    if (recent.length >= limit) {
      // The oldest ping in the window ages out first, freeing a slot.
      const oldestAgeMin = (Date.now() - new Date(recent[0].created_at).getTime()) / 60000
      const waitMin = Math.max(1, Math.ceil(PING_WINDOW_MINUTES - oldestAgeMin))
      return NextResponse.json(
        { success: false, error: `You've reached the limit of ${limit} ping${limit === 1 ? "" : "s"} per hour for this person. You can ask again in about ${waitMin} minute${waitMin === 1 ? "" : "s"}.`, code: "COOLDOWN" },
        { status: 429 }
      )
    }

    // A ping notifies the recipient exactly once - there are no reminders or
    // repeats, so someone busy is never nagged. If the requester wants to ask
    // again (the first was ignored), a new request replaces the old one and
    // sends one fresh notification.
    await sql`
      UPDATE location_requests SET status = 'CANCELLED'
      WHERE requester_user_id = ${user.id} AND target_user_id = ${membership[0].target_user_id}
        AND status = 'AWAITING_APPROVAL'
    `

    // The target must approve before their device shares anything. Status stays
    // AWAITING_APPROVAL (ignored by the device poll) until they approve.
    const requestId = `locreq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    await sql`
      INSERT INTO location_requests (
        id, requester_user_id, target_user_id, family_id,
        status, created_at, expires_at
      )
      VALUES (
        ${requestId},
        ${user.id},
        ${membership[0].target_user_id},
        ${validatedData.familyId},
        'AWAITING_APPROVAL',
        NOW(),
        NOW() + make_interval(mins => ${APPROVAL_WINDOW_MINUTES}::int)
      )
    `

    // In-app + push + text + email, each best-effort.
    try {
      await sendApprovalRequest({
        requestId,
        targetUserId: membership[0].target_user_id,
        requesterName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "A family member",
        familyId: validatedData.familyId,
      })
    } catch (err) {
      // The request is saved; a failed notification channel must not fail the ping.
      console.error("sendApprovalRequest failed (non-fatal):", err)
    }

    return NextResponse.json({
      success: true,
      message: "Approval request sent",
      data: { requestId, status: "AWAITING_APPROVAL" }
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Request location error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to request location", detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) },
      { status: 500 }
    )
  }
}

// Get pending location requests for the current user
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    await ensureLocationRequestsTable()
    // ?awaiting=1 -> requests this user still has to approve or deny.
    // default    -> approved requests the device should answer with a fresh fix.
    const status = new URL(request.url).searchParams.get("awaiting") ? "AWAITING_APPROVAL" : "PENDING"
    const requests = await sql`
      SELECT lr.*, u.first_name, u.last_name
      FROM location_requests lr
      JOIN users u ON lr.requester_user_id = u.id
      WHERE lr.target_user_id = ${user.id}
        AND lr.status = ${status}
        AND lr.expires_at > NOW()
      ORDER BY lr.created_at DESC
      LIMIT 10
    `

    return NextResponse.json({
      success: true,
      data: requests.map(r => ({
        id: r.id,
        requesterId: r.requester_user_id,
        requesterName: `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Family Member',
        familyId: r.family_id,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }))
    })
  } catch (error) {
    console.error("Get location requests error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get location requests" },
      { status: 500 }
    )
  }
}
