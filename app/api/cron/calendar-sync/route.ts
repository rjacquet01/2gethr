import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { syncGoogleConnection, syncAppleConnection } from "@/lib/services/calendar-sync-core"
import { syncAppleReminders } from "@/lib/services/apple-reminders-sync"
import { ensureSyncSchema } from "@/lib/sync-schema"

// Runs every 5 minutes (see vercel.json). For every enabled calendar-sync
// connection whose own syncIntervalMinutes (1/10/30/60 - configurable in
// Settings > Calendar Sync) has elapsed since its last sync, runs that
// connection's sync job here on the server.
//
// Previously the ONLY thing driving calendar sync was the client-side timer
// in components/calendar-auto-sync.tsx, which only runs while a browser tab
// has the app open - a user's "sync every 1 minute" setting did nothing
// while they weren't actively looking at the app. That client timer stays
// in place for responsiveness while the app is open; this cron job is the
// background safety net that makes the configured interval actually mean
// something the rest of the time. This project is on Vercel Pro, which
// supports per-minute cron precision (see app/api/cron/reminders/route.ts
// for the old, now-outdated Hobby-only assumption this project was built
// under).
function verifyCronRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }

    await ensureSyncSchema()

    // One row per enabled connection, joined to that user's active family
    // (same assumption the manual-sync routes make: one active family per
    // user). A connection with no active family membership is skipped.
    const connections = await sql`
      SELECT
        cc.id, cc.user_id, cc.provider,
        cc.access_token_encrypted, cc.refresh_token_encrypted, cc.token_expires_at,
        cc.external_calendar_id, cc.provider_account_email,
        cc.sync_direction, cc.sync_interval_minutes, cc.last_sync_at,
        cc.sync_tasks, cc.apple_task_calendar_url,
        fm.family_id
      FROM calendar_sync_connections cc
      JOIN family_members fm ON fm.user_id = cc.user_id AND fm.is_active = true
      WHERE cc.sync_enabled = true
    `

    let due = 0
    let synced = 0
    let failed = 0
    const errors: Array<{ connectionId: string; error: string }> = []

    for (const conn of connections) {
      const intervalMs = (conn.sync_interval_minutes || 30) * 60 * 1000
      const lastSync = conn.last_sync_at ? new Date(conn.last_sync_at).getTime() : null
      const isDue = lastSync === null || Date.now() - lastSync >= intervalMs

      if (!isDue) continue
      due++

      try {
        if (conn.provider === "google") {
          await syncGoogleConnection(conn, conn.family_id, conn.user_id)
        } else if (conn.provider === "apple") {
          // A row with no external calendar is just the subscription link
          // (nothing to sync server-side).
          if (!conn.external_calendar_id) continue
          await syncAppleConnection(conn, conn.family_id, conn.user_id)
          if (conn.sync_tasks && conn.apple_task_calendar_url) {
            await syncAppleReminders(conn, conn.family_id, conn.user_id)
          }
        } else {
          continue
        }
        synced++
      } catch (err) {
        failed++
        errors.push({
          connectionId: conn.id,
          error: err instanceof Error ? err.message : "Unknown sync error",
        })
        console.error(`[Cron] Calendar sync failed for connection ${conn.id} (${conn.provider}):`, err)
      }
    }

    console.log("[Cron] Calendar sync processed:", { checked: connections.length, due, synced, failed })

    return NextResponse.json({
      success: true,
      data: {
        checked: connections.length,
        due,
        synced,
        failed,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Cron calendar-sync error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to process calendar sync" },
      { status: 500 }
    )
  }
}

// Also allow POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request)
}
