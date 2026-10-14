import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { alertFamilyAdults } from "@/lib/family-alerts"

// Every 30 minutes (see vercel.json): a child whose sharing is still switched
// ON but whose phone hasn't reported a location for STALE_HOURS gets ONE quiet
// heads-up (in-app + push only) to their parents. This is the "silent stop"
// case (phone off, permission revoked, no signal) - deliberately softer than
// the all-channel alert when a child switches sharing off themselves. Skipped
// overnight in the child's own time zone, when a quiet phone is normal.
const STALE_HOURS = 3
const QUIET_START_HOUR = 22
const QUIET_END_HOUR = 7

function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

function localHour(tz: string | null): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz || "America/New_York" }).format(new Date())
    return parseInt(h, 10) % 24
  } catch {
    return new Date().getUTCHours()
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }

    const rows = await sql`
      SELECT fm.id AS member_id, fm.family_id, fm.user_id, u.timezone,
             COALESCE(cp.display_name, u.first_name, fm.nickname, 'Your child') AS name,
             (SELECT MAX(lp.timestamp) FROM location_pings lp WHERE lp.user_id = fm.user_id) AS last_ping
      FROM family_members fm
      JOIN location_settings ls ON ls.family_member_id = fm.id
      JOIN users u ON u.id = fm.user_id
      LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
      WHERE fm.role = 'CHILD' AND fm.is_active = true AND fm.user_id IS NOT NULL
        AND ls.mode = 'ACTIVE' AND ls.share_with_family = true
    `

    let alerted = 0
    for (const r of rows) {
      if (!r.last_ping) continue
      const ageMs = Date.now() - new Date(r.last_ping as string).getTime()
      if (ageMs < STALE_HOURS * 3600_000) continue
      const h = localHour(r.timezone as string | null)
      if (h >= QUIET_START_HOUR || h < QUIET_END_HOUR) continue

      // One alert per outage: skip if we already warned since their last fix.
      const already = await sql`
        SELECT 1 FROM notifications n
        WHERE n.data->>'subType' = 'SHARING_STALE' AND n.data->>'memberId' = ${r.member_id}
          AND n.created_at > ${r.last_ping}
        LIMIT 1
      `
      if (already.length > 0) continue

      const hours = Math.floor(ageMs / 3600_000)
      await alertFamilyAdults(r.family_id as string, r.user_id as string, {
        title: `${r.name} hasn't updated their location`,
        body: `${r.name} is still sharing, but their phone hasn't reported a location in about ${hours} hours. Their phone may be off, out of signal, or location access was changed.`,
        type: "LOCATION_ALERT",
        data: { subType: "SHARING_STALE", memberId: r.member_id },
        clickAction: "/location",
        soft: true,
      })
      alerted++
    }
    return NextResponse.json({ success: true, checked: rows.length, alerted })
  } catch (error) {
    console.error("location-stale cron error:", error)
    return NextResponse.json({ success: false, error: "Failed" }, { status: 500 })
  }
}
