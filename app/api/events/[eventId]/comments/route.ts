import { NextRequest, NextResponse } from "next/server"
import { actorNameInFamily } from "@/lib/member-names"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { eventCommentAccess } from "@/lib/event-comment-access"
import {
  EVENT_COMMENT_MAX,
  PAGE_SIZE_COMMENTS,
  RATE_LIMIT_MESSAGE,
  authorInfo,
  cleanBody,
  ensureSocialTables,
  notifySocial,
  overRateLimit,
  parseCursor,
} from "@/lib/social"

const notFound = () => NextResponse.json({ success: false, error: "Event not found" }, { status: 404 })

// GET - latest 50 comments, oldest first. ?before=<created_at> pages back,
// ?since=<created_at> returns only newer ones (cheap polling).
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await eventCommentAccess(eventId, user.id)
    if (!access) return notFound()

    const before = parseCursor(request.nextUrl.searchParams.get("before"))
    const since = parseCursor(request.nextUrl.searchParams.get("since"))
    const rows = await sql`
      SELECT id, user_id, body, created_at, updated_at
      FROM event_comments
      WHERE event_id = ${eventId} AND deleted_at IS NULL
        AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
        AND (${since}::timestamptz IS NULL OR created_at > ${since}::timestamptz)
      ORDER BY created_at DESC
      LIMIT ${PAGE_SIZE_COMMENTS + 1}
    `
    const hasMore = rows.length > PAGE_SIZE_COMMENTS
    const page = rows.slice(0, PAGE_SIZE_COMMENTS).reverse()
    const authors = await authorInfo(access.familyId, page.map((r) => r.user_id as string))
    return NextResponse.json({
      success: true,
      data: page.map((r) => ({
        id: r.id,
        userId: r.user_id,
        body: r.body,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        ...(authors.get(r.user_id as string) || { authorName: "Family member", avatarUrl: null, color: null, emoji: null }),
      })),
      hasMore,
    })
  } catch (error) {
    console.error("Event comments GET error:", error)
    return NextResponse.json({ success: false, error: "Failed to load comments" }, { status: 500 })
  }
}

// POST - add a comment { body }
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await eventCommentAccess(eventId, user.id)
    if (!access) return notFound()

    const payload = await request.json().catch(() => ({}))
    const cleaned = cleanBody(payload.body ?? payload.content, EVENT_COMMENT_MAX)
    if ("error" in cleaned) return NextResponse.json({ success: false, error: cleaned.error }, { status: 400 })
    if (await overRateLimit(user.id, "event_comment")) {
      return NextResponse.json({ success: false, error: RATE_LIMIT_MESSAGE }, { status: 429 })
    }

    const id = crypto.randomUUID()
    const ins = await sql`
      INSERT INTO event_comments (id, event_id, family_id, user_id, body)
      VALUES (${id}, ${eventId}, ${access.familyId}, ${user.id}, ${cleaned.body})
      RETURNING created_at, updated_at
    `

    // The creator and invited people (active members only), minus the author.
    // Anyone listed here can see the event, guests included.
    const recipients = await sql`
      SELECT DISTINCT fm.user_id
      FROM family_members fm
      WHERE fm.family_id = ${access.familyId} AND fm.is_active = true AND fm.user_id IS NOT NULL
        AND fm.user_id <> ${user.id}
        AND (fm.user_id = ${access.createdById}
             OR EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = ${eventId} AND ep.user_id = fm.user_id))
    `
    const name = await actorNameInFamily(access.familyId, user, "Someone")
    await notifySocial({
      recipientIds: recipients.map((r) => r.user_id as string),
      type: "EVENT_UPDATE",
      title: `New comment on "${access.title}"`,
      body: `${name}: ${cleaned.body.slice(0, 120)}`,
      data: { subType: "EVENT_COMMENT", eventId, familyId: access.familyId },
      push: true,
      scope: `event:${eventId}`,
      clickAction: `/calendar/event/${eventId}`,
    })

    const authors = await authorInfo(access.familyId, [user.id])
    return NextResponse.json(
      {
        success: true,
        data: { id, userId: user.id, body: cleaned.body, createdAt: ins[0].created_at, updatedAt: ins[0].updated_at, ...authors.get(user.id) },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Event comments POST error:", error)
    return NextResponse.json({ success: false, error: "Failed to add comment" }, { status: 500 })
  }
}
