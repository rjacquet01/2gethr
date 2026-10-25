import { NextRequest, NextResponse } from "next/server"
import { monitorCron } from "@/lib/cron-health"
import { sql } from "@/lib/db"
import { ensureSocialTables } from "@/lib/social"
import { markExpiredPins } from "@/lib/board-limits"
import { HISTORY_CAP_DAYS, MAX_ROWS_PER_TABLE, isHistoryPurgeEnabled, heldUserIds, heldFamilyIds, purgeBoardPosts } from "@/lib/retention"

// Daily (see vercel.json). Retention for event comments and the family board:
//  - anything soft-deleted more than 30 days ago is removed for good
//  - anything older than 90 days (HISTORY_CAP_DAYS, the stored-history cap
//    for every plan) is removed. RETENTION_PURGE_DISABLED=true restores the
//    old 365-day limit and only reports the 90-day count.
//  - at most MAX_ROWS_PER_TABLE rows per table per run (a warning is logged
//    when that cap is hit; the rest goes on the next run)
//  - board pins taken down more than BOARD_LIMITS.RESTORE_DAYS ago are removed,
//    and event flyers past their date are first recorded as taken down
//  - push-coalescing rows older than a day are dropped
// Posts and comments by someone under a legal case or hold, or in a held
// family, are never removed. A board post that goes takes its comments with
// it, and its flyer photo files are deleted from Blob storage before the row.
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
    await ensureSocialTables()
    const heldUsers = await heldUserIds()
    const heldFamilies = await heldFamilyIds()
    const purgeEnabled = isHistoryPurgeEnabled()
    const ageDays = purgeEnabled ? HISTORY_CAP_DAYS : 365
    const cap = MAX_ROWS_PER_TABLE

    // What the 90-day rule would remove (reported only when it is switched off).
    const wouldDelete = purgeEnabled ? null : (await sql`
      SELECT
        (SELECT count(*)::int FROM event_comments WHERE created_at < NOW() - make_interval(days => ${HISTORY_CAP_DAYS}::int)
           AND NOT (user_id = ANY(${heldUsers}::text[])) AND NOT (family_id = ANY(${heldFamilies}::text[]))) AS event_comments,
        (SELECT count(*)::int FROM family_post_comments WHERE created_at < NOW() - make_interval(days => ${HISTORY_CAP_DAYS}::int)
           AND NOT (user_id = ANY(${heldUsers}::text[])) AND NOT (family_id = ANY(${heldFamilies}::text[]))) AS post_comments,
        (SELECT count(*)::int FROM family_posts WHERE created_at < NOW() - make_interval(days => ${HISTORY_CAP_DAYS}::int)
           AND NOT (user_id = ANY(${heldUsers}::text[])) AND NOT (family_id = ANY(${heldFamilies}::text[]))) AS posts
    `)[0]

    // Each delete is capped at MAX_ROWS_PER_TABLE rows per run (oldest first).
    const eventComments = await sql`
      DELETE FROM event_comments WHERE id IN (
        SELECT id FROM event_comments
        WHERE ((deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
           OR created_at < NOW() - make_interval(days => ${ageDays}::int))
          AND NOT (user_id = ANY(${heldUsers}::text[]))
          AND NOT (family_id = ANY(${heldFamilies}::text[]))
        ORDER BY created_at
        LIMIT ${cap}
      )
      RETURNING id
    `
    const postComments = await sql`
      DELETE FROM family_post_comments WHERE id IN (
        SELECT id FROM family_post_comments
        WHERE ((deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
           OR created_at < NOW() - make_interval(days => ${ageDays}::int))
          AND NOT (user_id = ANY(${heldUsers}::text[]))
          AND NOT (family_id = ANY(${heldFamilies}::text[]))
        ORDER BY created_at
        LIMIT ${cap}
      )
      RETURNING id
    `
    // Event flyers past their date are recorded as taken down (reads already
    // hide them), so they show in Taken down and are purged on schedule.
    const pinsExpired = await markExpiredPins()
    // Posts take their remaining comments with them, and flyer photos are
    // deleted from storage first (lib/retention.ts purgeBoardPosts).
    const board = await purgeBoardPosts({ dryRun: false, ageDays, maxRows: cap, commentsAlreadyDeleted: postComments.length })
    const orphanComments = board.postComments
    const postsDeleted = board.posts
    const postsCapped = board.capped
    const capped = eventComments.length >= cap || postComments.length >= cap || postsCapped
    if (capped) {
      console.warn(`[comments-cleanup] per-table cap of ${cap} rows reached; the rest is left for the next run`)
    }
    console.log("[comments-cleanup]", { ageDays, pinsExpired, eventComments: eventComments.length, postComments: postComments.length + orphanComments, posts: postsDeleted, flyerFiles: board.flyerFiles, flyersKeptForRetry: board.keptForRetry, capped })
    const pushLog = await sql`DELETE FROM social_push_log WHERE last_push_at < NOW() - INTERVAL '1 day' RETURNING user_id`

    return NextResponse.json({
      success: true,
      data: {
        eventComments: eventComments.length,
        postComments: postComments.length + orphanComments,
        posts: postsDeleted,
        pinsExpired,
        flyerFiles: board.flyerFiles,
        pushLog: pushLog.length,
        ageDays,
        capped,
        wouldDeleteAt90Days: wouldDelete,
      },
    })
  } catch (error) {
    console.error("Comments cleanup cron error:", error)
    return NextResponse.json({ success: false, error: "Comments cleanup failed" }, { status: 500 })
  }
}

export const GET = monitorCron("comments-cleanup", runJob)
