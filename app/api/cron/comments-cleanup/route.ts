import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { ensureSocialTables } from "@/lib/social"

// Daily (see vercel.json). Retention for event comments and the family board:
//  - anything soft-deleted more than 30 days ago is removed for good
//  - anything older than 365 days is removed
//  - push-coalescing rows older than a day are dropped
// A board post that goes also takes its comments with it.
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

    const eventComments = await sql`
      DELETE FROM event_comments
      WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
         OR created_at < NOW() - INTERVAL '365 days'
      RETURNING id
    `
    const postComments = await sql`
      DELETE FROM family_post_comments
      WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
         OR created_at < NOW() - INTERVAL '365 days'
      RETURNING id
    `
    const posts = await sql`
      DELETE FROM family_posts
      WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
         OR created_at < NOW() - INTERVAL '365 days'
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
      },
    })
  } catch (error) {
    console.error("Comments cleanup cron error:", error)
    return NextResponse.json({ success: false, error: "Comments cleanup failed" }, { status: 500 })
  }
}
