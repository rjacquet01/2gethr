import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { z } from "zod"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { APPROVED_WINDOW_MINUTES, notifyRequesterOutcome } from "@/lib/location-approval"

const schema = z.object({ action: z.enum(["approve", "deny"]) })

// The pinged parent approves or denies. Only an approval lets their device
// share a fresh location (status PENDING is what the device poll looks for).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })

    const { id } = await params
    const { action } = schema.parse(await request.json())
    await ensureLocationRequestsTable()

    const rows = await sql`
      SELECT id, requester_user_id, target_user_id, status, expires_at
      FROM location_requests WHERE id = ${id} LIMIT 1
    `
    const r = rows[0]
    if (!r || r.target_user_id !== user.id) {
      return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
    }
    if (r.status !== "AWAITING_APPROVAL") {
      return NextResponse.json({ success: false, error: "This request was already answered or has expired", code: "NOT_PENDING" }, { status: 409 })
    }
    if (new Date(r.expires_at).getTime() <= Date.now()) {
      await sql`UPDATE location_requests SET status = 'EXPIRED' WHERE id = ${id} AND status = 'AWAITING_APPROVAL'`
      return NextResponse.json({ success: false, error: "This request has expired", code: "EXPIRED" }, { status: 410 })
    }

    const targetName = user.firstName || "Your family member"
    if (action === "approve") {
      const upd = await sql`
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
