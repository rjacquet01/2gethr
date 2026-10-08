import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription } from "@/lib/auth"
import { z } from "zod"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { sendPushToUser, isFirebaseConfigured } from "@/lib/services/push"

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

    // Verify user is a PARENT in this family and get target member info
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

    // Only parents/guardians (and admins) can request another member's location.
    // The UI already hides the "Ping" button for other roles, but that must also
    // be enforced server-side, or a CHILD account could directly call this
    // endpoint to request anyone's location, including a parent's.
    const requesterRole = membership[0].role
    if (!["PARENT", "GUARDIAN", "ADMIN"].includes(requesterRole)) {
      return NextResponse.json(
        { success: false, error: "Only parents or guardians can request a family member's location" },
        { status: 403 }
      )
    }

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

    // Check if member has location sharing enabled
    const locationSettings = await sql`
      SELECT mode, share_with_family FROM location_settings 
      WHERE family_member_id = ${validatedData.memberId}
    `

    if (locationSettings.length === 0 || 
        locationSettings[0].mode === 'OFF' || 
        !locationSettings[0].share_with_family) {
      return NextResponse.json(
        { success: false, error: "This family member has location sharing disabled" },
        { status: 400 }
      )
    }

    // Create a location request notification for the target member
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
      VALUES (
        ${notifId},
        ${membership[0].target_user_id},
        'LOCATION_ALERT',
        'Location Request',
        ${`${user.firstName || 'A family member'} has requested your current location`},
        ${JSON.stringify({ 
          subType: 'LOCATION_REQUEST',
          requesterId: user.id, 
          requesterName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          familyId: validatedData.familyId,
          requestedAt: new Date().toISOString()
        })}::jsonb,
        NOW()
      )
    `

    // Also store as a pending location request for the device to check
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
        'PENDING',
        NOW(),
        NOW() + INTERVAL '5 minutes'
      )
      ON CONFLICT DO NOTHING
    `

    // Best-effort push so a phone that is only running the background
    // service still lights up; the service also polls for pending requests.
    if (isFirebaseConfigured()) {
      try {
        await sendPushToUser(membership[0].target_user_id, {
          title: "Location Request",
          body: `${user.firstName || 'A family member'} has requested your current location`,
          data: { type: "LOCATION_REQUEST" },
          clickAction: "/location",
        })
      } catch (err) {
        console.error("Location request push failed (non-fatal):", err)
      }
    }

    return NextResponse.json({
      success: true,
      message: "Location request sent successfully",
      data: { requestId }
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
      { success: false, error: "Failed to request location" },
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
    // Get pending requests for this user that haven't expired
    const requests = await sql`
      SELECT lr.*, u.first_name, u.last_name
      FROM location_requests lr
      JOIN users u ON lr.requester_user_id = u.id
      WHERE lr.target_user_id = ${user.id}
        AND lr.status = 'PENDING'
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
