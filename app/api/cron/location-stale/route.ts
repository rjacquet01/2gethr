import { NextRequest, NextResponse } from "next/server"
import { monitorCron } from "@/lib/cron-health"
import { sql } from "@/lib/db"
import { alertFamilyAdults } from "@/lib/family-alerts"
import { sendPushToUser, isFirebaseConfigured } from "@/lib/services/push"

// Every 30 minutes (see vercel.json): a child whose sharing is still switched
// ON but whose phone hasn't reported a location for STALE_HOURS gets ONE quiet
// heads-up (in-app + push only) to their parents. This is the "silent stop"
// case (phone off, permission revoked, no signal) - deliberately softer than
// the all-channel alert when a child switches sharing off themselves. Skipped
// overnight in the child's own time zone, when a quiet phone is normal.
const STALE_HOURS = 3
const QUIET_START_HOUR = 22
const QUIET_END_HOUR = 7
// The Android app's background service polls every 45 s with its device
// token; this long without one while sharing is on means Android stopped it.
const BG_STOPPED_MINUTES = 15

function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== "production" // fail closed in production
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

async function runJob(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }

    const rows = await sql`
      SELECT fm.id AS member_id, fm.family_id, fm.user_id, u.timezone,
             COALESCE(CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE COALESCE(NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) END, 'Your child') AS name,
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
    // "Tap to resume": tell the person themselves when the Android app's
    // background sharing has stopped (battery saver, force stop, update) while
    // sharing is still on. Tapping opens /location?resume=1, which offers a
    // one-tap restart. Once per outage; never overnight.
    const stopped = await sql`
      SELECT DISTINCT ON (t.user_id) t.id AS token_id, t.user_id, t.last_used_at, u.timezone
      FROM location_device_tokens t
      JOIN location_settings ls ON ls.family_member_id = t.family_member_id
      JOIN family_members fm ON fm.id = t.family_member_id AND fm.is_active = true
      JOIN users u ON u.id = t.user_id
      WHERE t.revoked_at IS NULL
        AND t.last_used_at < NOW() - make_interval(mins => ${BG_STOPPED_MINUTES}::int)
        AND t.last_used_at > NOW() - INTERVAL '7 days'
        AND ls.mode = 'ACTIVE' AND ls.share_with_family = true
      ORDER BY t.user_id, t.last_used_at DESC
    `
    let resumeNudges = 0
    for (const r of stopped) {
      // A newer token (sharing re-enabled on this or another phone) that is
      // working means nothing has stopped.
      const working = await sql`
        SELECT 1 FROM location_device_tokens
        WHERE user_id = ${r.user_id} AND revoked_at IS NULL
          AND last_used_at >= NOW() - make_interval(mins => ${BG_STOPPED_MINUTES}::int)
        LIMIT 1
      `
      if (working.length > 0) continue
      const h = localHour(r.timezone as string | null)
      if (h >= QUIET_START_HOUR || h < QUIET_END_HOUR) continue
      const already = await sql`
        SELECT 1 FROM notifications n
        WHERE n.user_id = ${r.user_id} AND n.data->>'subType' = 'BG_SHARING_STOPPED'
          AND n.created_at > ${r.last_used_at}
        LIMIT 1
      `
      if (already.length > 0) continue

      const title = "Location sharing stopped"
      const body = "Your phone stopped sharing your location in the background. Tap to turn it back on."
      await sql`
        INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
        VALUES (
          ${`notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`},
          ${r.user_id}, 'LOCATION_ALERT', ${title}, ${body},
          ${JSON.stringify({ subType: "BG_SHARING_STOPPED", tokenId: r.token_id })}::jsonb, NOW()
        )
      `
      if (isFirebaseConfigured()) {
        try {
          await sendPushToUser(r.user_id as string, {
            title,
            body,
            data: { type: "LOCATION_ALERT", subType: "BG_SHARING_STOPPED" },
            clickAction: "/location?resume=1",
          })
        } catch (err) {
          console.error("tap-to-resume push failed:", err)
        }
      }
      resumeNudges++
    }

    return NextResponse.json({ success: true, checked: rows.length, alerted, resumeNudges })
  } catch (error) {
    console.error("location-stale cron error:", error)
    return NextResponse.json({ success: false, error: "Failed" }, { status: 500 })
  }
}

export const GET = monitorCron("location-stale", runJob)
