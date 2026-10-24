import { NextRequest, NextResponse } from "next/server"
import { monitorCron } from "@/lib/cron-health"
import { sql } from "@/lib/db"
import { ensureLegalTables } from "@/lib/legal"
import { ensureLocationRequestsTable } from "@/lib/location-schema"

// Daily: enforce the location data retention cap. Data covered by an open or
// approved legal case (or a preservation request) is never purged.
// LOCATION_RETENTION_DAYS (default 90) is the maximum history kept for any plan.
function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== "production" // fail closed in production
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

async function runJob(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    await ensureLegalTables()
    await ensureLocationRequestsTable()
    const days = Math.max(7, Number(process.env.LOCATION_RETENTION_DAYS) || 90)

    const pings = await sql`
      WITH held AS (
        SELECT c.scope_user_id AS user_id FROM legal_cases c
        WHERE c.scope_user_id IS NOT NULL AND (c.status IN ('OPEN','APPROVED') OR c.preserve_until > NOW())
        UNION
        SELECT fm.user_id FROM legal_cases c JOIN family_members fm ON fm.family_id = c.scope_family_id
        WHERE c.scope_family_id IS NOT NULL AND fm.user_id IS NOT NULL AND (c.status IN ('OPEN','APPROVED') OR c.preserve_until > NOW())
      ), del AS (
        DELETE FROM location_pings
        WHERE timestamp < NOW() - make_interval(days => ${days}::int)
          AND user_id NOT IN (SELECT user_id FROM held WHERE user_id IS NOT NULL)
        RETURNING 1
      ) SELECT COUNT(*)::int AS n FROM del
    `
    const geofence = await sql`
      WITH held AS (
        SELECT c.scope_user_id AS user_id FROM legal_cases c
        WHERE c.scope_user_id IS NOT NULL AND (c.status IN ('OPEN','APPROVED') OR c.preserve_until > NOW())
        UNION
        SELECT fm.user_id FROM legal_cases c JOIN family_members fm ON fm.family_id = c.scope_family_id
        WHERE c.scope_family_id IS NOT NULL AND fm.user_id IS NOT NULL AND (c.status IN ('OPEN','APPROVED') OR c.preserve_until > NOW())
      ), del AS (
        DELETE FROM geofence_events
        WHERE timestamp < NOW() - make_interval(days => ${days}::int)
          AND user_id NOT IN (SELECT user_id FROM held WHERE user_id IS NOT NULL)
        RETURNING 1
      ) SELECT COUNT(*)::int AS n FROM del
    `
    // One-time ping snapshots hold coordinates: clear them after 30 days (unless held).
    const snaps = await sql`
      WITH held AS (
        SELECT c.scope_user_id AS user_id FROM legal_cases c
        WHERE c.scope_user_id IS NOT NULL AND (c.status IN ('OPEN','APPROVED') OR c.preserve_until > NOW())
        UNION
        SELECT fm.user_id FROM legal_cases c JOIN family_members fm ON fm.family_id = c.scope_family_id
        WHERE c.scope_family_id IS NOT NULL AND fm.user_id IS NOT NULL AND (c.status IN ('OPEN','APPROVED') OR c.preserve_until > NOW())
      ), upd AS (
        UPDATE location_requests
        SET snapshot_lat = NULL, snapshot_lng = NULL, snapshot_accuracy = NULL
        WHERE snapshot_lat IS NOT NULL AND snapshot_at < NOW() - INTERVAL '30 days'
          AND target_user_id NOT IN (SELECT user_id FROM held WHERE user_id IS NOT NULL)
        RETURNING 1
      ) SELECT COUNT(*)::int AS n FROM upd
    `
    return NextResponse.json({ success: true, retentionDays: days, pingsDeleted: pings[0]?.n || 0, geofenceDeleted: geofence[0]?.n || 0, snapshotsCleared: snaps[0]?.n || 0 })
  } catch (e) {
    console.error("legal-retention cron error:", e)
    return NextResponse.json({ success: false, error: "Retention job failed" }, { status: 500 })
  }
}

export const GET = monitorCron("legal-retention", runJob)
