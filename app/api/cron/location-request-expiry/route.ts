import { NextRequest, NextResponse } from "next/server"
import { monitorCron } from "@/lib/cron-health"
import { sql } from "@/lib/db"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { notifyRequesterExpired } from "@/lib/location-approval"
import { actorNameInFamily } from "@/lib/member-names"

// Every 15 minutes (see vercel.json): a location ping nobody answered within
// its 24-hour window is marked EXPIRED and the requester is told once.
function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== "production" // fail closed in production
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

async function runJob(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
    await ensureLocationRequestsTable()

    const expired = await sql`
      UPDATE location_requests
      SET status = 'EXPIRED', expiry_notified = true
      WHERE status = 'AWAITING_APPROVAL' AND expires_at <= NOW() AND expiry_notified = false
      RETURNING id, requester_user_id, target_user_id, family_id
    `
    let notified = 0
    for (const r of expired) {
      const names = await sql`SELECT first_name FROM users WHERE id = ${r.target_user_id} LIMIT 1`
      const name = await actorNameInFamily(r.family_id as string, { id: r.target_user_id as string, firstName: names[0]?.first_name as string | null }, "They")
      await notifyRequesterExpired(r.requester_user_id as string, name)
      notified++
    }
    return NextResponse.json({ success: true, expired: expired.length, notified })
  } catch (error) {
    console.error("location-request-expiry cron error:", error)
    return NextResponse.json({ success: false, error: "Failed" }, { status: 500 })
  }
}

export const GET = monitorCron("location-request-expiry", runJob)
