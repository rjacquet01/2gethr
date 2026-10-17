import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { purgeArchivedHistory, HISTORY_CAP_DAYS, HISTORY_PURGE_ENABLED } from "@/lib/retention"

// Runs nightly (see vercel.json). Auto-archives, for every family:
//  - tasks sitting in COMPLETED/CANCELLED (same bulk logic as the manual
//    "Archive" action in POST /api/tasks/archive)
//  - events whose end_time has passed and aren't already ARCHIVED/CANCELLED
//    (same logic as POST /api/events/archive { action: 'archive_past' })
//
// Both of those POST routes already existed but had no caller anywhere in
// the UI - there was no button or any other trigger for either of them, so
// completed tasks and past events just piled up until a user happened to
// open the Archive page's filters. This cron job is what actually keeps
// the active Tasks/Events views pruned automatically.
//
// It then enforces the 90-day stored-history cap (lib/retention.ts):
// archived items past the cap are deleted for good, unless under a legal hold.
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

    const families = await sql`SELECT id FROM families`

    let tasksArchived = 0
    let eventsArchived = 0

    for (const family of families) {
      // task_history.user_id is NOT NULL (no system/cron user exists), so
      // each history row is attributed to the task's own creator, same as
      // "who caused this" would read for any other automated status change.
      const archivedTasks = await sql`
        UPDATE tasks
        SET status = 'ARCHIVED', updated_at = NOW()
        WHERE family_id = ${family.id}
        AND status IN ('COMPLETED', 'CANCELLED', 'APPROVED')
        AND updated_at < NOW() - INTERVAL '5 days'
        RETURNING id, created_by_id
      `

      for (const task of archivedTasks) {
        await sql`
          INSERT INTO task_history (task_id, user_id, action, new_value)
          VALUES (${task.id}, ${task.created_by_id}, 'ARCHIVED', '{"bulk": true, "source": "cron"}'::jsonb)
        `
      }
      tasksArchived += archivedTasks.length

      // Done/dismissed reminders also age out after 5 days.
      await sql`
        UPDATE reminders
        SET status = 'ARCHIVED', updated_at = NOW()
        WHERE family_id = ${family.id}
        AND status IN ('COMPLETED', 'DISMISSED')
        AND updated_at < NOW() - INTERVAL '5 days'
      `

      const archivedEvents = await sql`
        UPDATE events e
        SET status = 'ARCHIVED'
        FROM calendars c
        WHERE e.calendar_id = c.id
        AND c.family_id = ${family.id}
        AND e.end_time < NOW()
        AND e.status != 'ARCHIVED'
        AND e.status != 'CANCELLED'
        RETURNING e.id
      `
      eventsArchived += archivedEvents.length
    }

    console.log("[Cron] Auto-archive processed:", { families: families.length, tasksArchived, eventsArchived })

    // 90-day cap: archived tasks/events/reminders past HISTORY_CAP_DAYS are
    // deleted with their child rows (legal holds excluded). Report-only until
    // HISTORY_PURGE_ENABLED is switched on.
    const purge = await purgeArchivedHistory({ dryRun: !HISTORY_PURGE_ENABLED })
    console.log(`[Cron] History cap ${HISTORY_CAP_DAYS}d ${HISTORY_PURGE_ENABLED ? "purged" : "would purge"}:`, purge)

    return NextResponse.json({
      success: true,
      data: {
        familiesChecked: families.length,
        tasksArchived,
        eventsArchived,
        historyCap: { days: HISTORY_CAP_DAYS, enabled: HISTORY_PURGE_ENABLED, ...purge },
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Cron archive error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to process auto-archive" },
      { status: 500 }
    )
  }
}

// Also allow POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request)
}
