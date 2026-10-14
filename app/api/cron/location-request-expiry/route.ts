import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { notifyRequesterExpired } from "@/lib/location-approval"

// Every 15 minutes (see vercel.json): a location ping nobody answered within
// its 24-hour window is marked EXPIRED and the requester is told once.
function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
    await ensureLocationRequestsTable()

    const expired = await sql`
      UPDATE location_requests
      SET status = 'EXPIRED', expiry_notified = true
      WHERE status = 'AWAITING_APPROVAL' AND expires_at <= NOW() AND expiry_notified = false
      RETURNING id, requester_user_id, target_user_id
    `
    let notified = 0
    for (const r of expired) {
      const names = await sql`SELECT first_name, last_name FROM users WHERE id = ${r.target_user_id} LIMIT 1`
      const name = `${names[0]?.first_name || ""} ${names[0]?.last_name || ""}`.trim() || "They"
      await notifyRequesterExpired(r.requester_user_id as string, name)
      notified++
    }
    return NextResponse.json({ success: true, expired: expired.length, notified })
  } catch (error) {
    console.error("location-request-expiry cron error:", error)
    return NextResponse.json({ success: false, error: "Failed" }, { status: 500 })
  }
}
