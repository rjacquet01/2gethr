import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { ensureSocialTables } from "@/lib/social"
import { HISTORY_CAP_DAYS, MAX_ROWS_PER_TABLE, isHistoryPurgeEnabled, heldUserIds, heldFamilyIds } from "@/lib/retention"

// Daily (see vercel.json). Retention for event comments and the family board:
//  - anything soft-deleted more than 30 days ago is removed for good
//  - anything older than 90 days (HISTORY_CAP_DAYS, the stored-history cap
//    for every plan) is removed. RETENTION_PURGE_DISABLED=true restores the
//    old 365-day limit and only reports the 90-day count.
//  - at most MAX_ROWS_PER_TABLE rows per table per run (a warning is logged
//    when that cap is hit; the rest goes on the next run)
//  - push-coalescing rows older than a day are dropped
// Posts and comments by someone under a legal case or hold, or in a held
// family, are never removed. A board post that goes takes its comments with it.
function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== "production" // fail closed in production
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

export async function GET(request: NextRequest) {
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
    // A post takes its remaining comments with it; both tables stay under the
    // cap, so only as many posts go as their comments allow.
    const postCandidates = await sql`
      SELECT p.id, (SELECT count(*)::int FROM family_post_comments c WHERE c.post_id = p.id) AS comments
      FROM family_posts p
      WHERE ((p.deleted_at IS NOT NULL AND p.deleted_at < NOW() - INTERVAL '30 days')
         OR p.created_at < NOW() - make_interval(days => ${ageDays}::int))
        AND NOT (p.user_id = ANY(${heldUsers}::text[]))
        AND NOT (p.family_id = ANY(${heldFamilies}::text[]))
      ORDER BY p.created_at
      LIMIT ${cap + 1}
    `
    let commentBudget = cap - postComments.length
    const postIds: string[] = []
    let postsCapped = postCandidates.length > cap
    for (const pc of postCandidates.slice(0, cap)) {
      const n = Number(pc.comments)
      if (n > commentBudget) { postsCapped = true; continue }
      commentBudget -= n
      postIds.push(pc.id as string)
    }
    let orphanComments = 0
    let postsDeleted = 0
    if (postIds.length > 0) {
      orphanComments = (await sql`DELETE FROM family_post_comments WHERE post_id = ANY(${postIds}::text[]) RETURNING id`).length
      postsDeleted = (await sql`DELETE FROM family_posts WHERE id = ANY(${postIds}::text[]) RETURNING id`).length
    }
    const capped = eventComments.length >= cap || postComments.length >= cap || postsCapped
    if (capped) {
      console.warn(`[comments-cleanup] per-table cap of ${cap} rows reached; the rest is left for the next run`)
    }
    console.log("[comments-cleanup]", { ageDays, eventComments: eventComments.length, postComments: postComments.length + orphanComments, posts: postsDeleted, capped })
    const pushLog = await sql`DELETE FROM social_push_log WHERE last_push_at < NOW() - INTERVAL '1 day' RETURNING user_id`

    return NextResponse.json({
      success: true,
      data: {
        eventComments: eventComments.length,
        postComments: postComments.length + orphanComments,
        posts: postsDeleted,
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
