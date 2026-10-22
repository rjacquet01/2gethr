import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { z } from "zod"
import { answerLocationRequests, ensureLocationRequestsTable } from "@/lib/location-schema"
import { APPROVED_WINDOW_MINUTES, notifyRequesterOutcome } from "@/lib/location-approval"
import { guestForbidden, isGuestInFamily } from "@/lib/permissions"
import { actorNameInFamily } from "@/lib/member-names"

const schema = z.object({
  action: z.enum(["approve", "deny", "answer"]),
  // One-time snapshot taken on the approving device at the moment of approval.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100000).optional().nullable(),
})

// The pinged person approves or denies. Only an approval lets their device
// share a fresh location (status PENDING is what the device poll looks for).
// "answer" is the device replying to an open PENDING ping with a fix.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })

    const { id } = await params
    const { action, latitude, longitude, accuracy } = schema.parse(await request.json())
    await ensureLocationRequestsTable()

    const rows = await sql`
      SELECT id, requester_user_id, target_user_id, family_id, status, expires_at
      FROM location_requests WHERE id = ${id} LIMIT 1
    `
    const r = rows[0]
    if (!r || r.target_user_id !== user.id) {
      return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    }
    if (await isGuestInFamily(r.family_id, user.id)) return guestForbidden()

    // "answer": the pinged phone sends its fix for a ping that needs no
    // approval (a parent pinging their child), stored as a one-time snapshot
    // for the requester only.
    if (action === "answer") {
      if (latitude === undefined || longitude === undefined) {
        return NextResponse.json({ success: false, error: "A location is required" }, { status: 400 })
      }
      const answered = await answerLocationRequests(user.id, { latitude, longitude, accuracy }, id)
      if (answered === 0) {
        return NextResponse.json({ success: false, error: "This request was already answered or has expired", code: "NOT_PENDING" }, { status: 409 })
      }
      return NextResponse.json({ success: true, data: { status: "FULFILLED" } })
    }

    if (r.status !== "AWAITING_APPROVAL") {
      return NextResponse.json({ success: false, error: "This request was already answered or has expired", code: "NOT_PENDING" }, { status: 409 })
    }
    if (new Date(r.expires_at).getTime() <= Date.now()) {
      await sql`UPDATE location_requests SET status = 'EXPIRED' WHERE id = ${id} AND status = 'AWAITING_APPROVAL'`
      return NextResponse.json({ success: false, error: "This request has expired", code: "EXPIRED" }, { status: 410 })
    }

    const targetName = await actorNameInFamily(r.family_id as string, user, "Your family member")
    if (action === "approve") {
      const hasFix = latitude !== undefined && longitude !== undefined
      // With a fix from the approving device: store the one-time snapshot now.
      // Without one, fall back to the device poll answering within a few minutes.
      const upd = hasFix
        ? await sql`
            UPDATE location_requests
            SET status = 'FULFILLED', fulfilled_at = NOW(), snapshot_lat = ${latitude}, snapshot_lng = ${longitude},
                snapshot_accuracy = ${accuracy ?? null}, snapshot_at = NOW()
            WHERE id = ${id} AND status = 'AWAITING_APPROVAL' RETURNING id
          `
        : await sql`
            UPDATE location_requests
            SET status = 'PENDING', expires_at = NOW() + make_interval(mins => ${APPROVED_WINDOW_MINUTES}::int)
            WHERE id = ${id} AND status = 'AWAITING_APPROVAL' RETURNING id
          `
      if (upd.length === 0) return NextResponse.json({ success: false, error: "Already answered", code: "NOT_PENDING" }, { status: 409 })
      await notifyRequesterOutcome(r.requester_user_id, targetName, "APPROVED")
    } else {
      const upd = await sql`
        UPDATE location_requests SET status = 'DENIED'
        WHERE id = ${id} AND status = 'AWAITING_APPROVAL' RETURNING id
      `
      if (upd.length === 0) return NextResponse.json({ success: false, error: "Already answered", code: "NOT_PENDING" }, { status: 409 })
      await notifyRequesterOutcome(r.requester_user_id, targetName, "DENIED")
    }
    return NextResponse.json({ success: true, data: { status: action === "approve" ? "APPROVED" : "DENIED" } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Respond to location request error:", error)
    return NextResponse.json({ success: false, error: "Failed to respond" }, { status: 500 })
  }
}
