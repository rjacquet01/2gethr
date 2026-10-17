import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { ensureSocialTables } from "@/lib/social"
import { HISTORY_CAP_DAYS, HISTORY_PURGE_ENABLED, heldUserIds, heldFamilyIds } from "@/lib/retention"

// Daily (see vercel.json). Retention for event comments and the family board:
//  - anything soft-deleted more than 30 days ago is removed for good
//  - anything older than 90 days (HISTORY_CAP_DAYS, the stored-history cap
//    for every plan) is removed. Until HISTORY_PURGE_ENABLED is switched on
//    the old 365-day limit still applies and the 90-day count is reported.
//  - push-coalescing rows older than a day are dropped
// Posts and comments by someone under a legal case or hold, or in a held
// family, are never removed. A board post that goes takes its comments with it.
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
    await ensureSocialTables()
    const heldUsers = await heldUserIds()
    const heldFamilies = await heldFamilyIds()
    const ageDays = HISTORY_PURGE_ENABLED ? HISTORY_CAP_DAYS : 365

    // What the 90-day rule removes (reported while it is still switched off).
    const wouldDelete = HISTORY_PURGE_ENABLED ? null : (await sql`
      SELECT
        (SELECT count(*)::int FROM event_comments WHERE created_at < NOW() - make_interval(days => ${HISTORY_CAP_DAYS}::int)
           AND NOT (user_id = ANY(${heldUsers}::text[])) AND NOT (family_id = ANY(${heldFamilies}::text[]))) AS event_comments,
        (SELECT count(*)::int FROM family_post_comments WHERE created_at < NOW() - make_interval(days => ${HISTORY_CAP_DAYS}::int)
           AND NOT (user_id = ANY(${heldUsers}::text[])) AND NOT (family_id = ANY(${heldFamilies}::text[]))) AS post_comments,
        (SELECT count(*)::int FROM family_posts WHERE created_at < NOW() - make_interval(days => ${HISTORY_CAP_DAYS}::int)
           AND NOT (user_id = ANY(${heldUsers}::text[])) AND NOT (family_id = ANY(${heldFamilies}::text[]))) AS posts
    `)[0]

    const eventComments = await sql`
      DELETE FROM event_comments
      WHERE ((deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
         OR created_at < NOW() - make_interval(days => ${ageDays}::int))
        AND NOT (user_id = ANY(${heldUsers}::text[]))
        AND NOT (family_id = ANY(${heldFamilies}::text[]))
      RETURNING id
    `
    const postComments = await sql`
      DELETE FROM family_post_comments
      WHERE ((deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
         OR created_at < NOW() - make_interval(days => ${ageDays}::int))
        AND NOT (user_id = ANY(${heldUsers}::text[]))
        AND NOT (family_id = ANY(${heldFamilies}::text[]))
      RETURNING id
    `
    const posts = await sql`
      DELETE FROM family_posts
      WHERE ((deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
         OR created_at < NOW() - make_interval(days => ${ageDays}::int))
        AND NOT (user_id = ANY(${heldUsers}::text[]))
        AND NOT (family_id = ANY(${heldFamilies}::text[]))
      RETURNING id
    `
    let orphanComments = 0
    if (posts.length > 0) {
      const gone = await sql`
        DELETE FROM family_post_comments WHERE post_id = ANY(${posts.map((p) => p.id as string)}::text[]) RETURNING id
      `
      orphanComments = gone.length
    }
    const pushLog = await sql`DELETE FROM social_push_log WHERE last_push_at < NOW() - INTERVAL '1 day' RETURNING user_id`

    return NextResponse.json({
      success: true,
      data: {
        eventComments: eventComments.length,
        postComments: postComments.length + orphanComments,
        posts: posts.length,
        pushLog: pushLog.length,
        ageDays,
        wouldDeleteAt90Days: wouldDelete,
      },
    })
  } catch (error) {
    console.error("Comments cleanup cron error:", error)
    return NextResponse.json({ success: false, error: "Comments cleanup failed" }, { status: 500 })
  }
}
