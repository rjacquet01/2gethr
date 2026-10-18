import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess, notifyNewPost, shapePosts } from "@/lib/board"
import { ensureBoardFlyerColumns } from "@/lib/board-flyers"
import {
  PAGE_SIZE_POSTS,
  POST_MAX,
  RATE_LIMIT_MESSAGE,
  cleanBody,
  ensureSocialTables,
  overRateLimit,
  parseCursor,
} from "@/lib/social"

const MAX_PINNED = 10

// GET - the family board, newest first, 20 per page.
//   page one (no cursor): pinned posts first, then the latest unpinned posts
//   ?before=<created_at>: the next page of unpinned posts
//   ?since=<created_at>:  only posts newer than that (tiny when nothing is new)
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardFlyerColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access

    const since = parseCursor(request.nextUrl.searchParams.get("since"))
    if (since) {
      const fresh = await sql`
        SELECT id, user_id, body, pinned, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at FROM family_posts
        WHERE family_id = ${familyId} AND deleted_at IS NULL AND created_at > ${since}::timestamptz
        ORDER BY created_at DESC
        LIMIT ${PAGE_SIZE_POSTS}
      `
      return NextResponse.json({ success: true, data: { posts: fresh.length ? await shapePosts(familyId, fresh) : [] } })
    }

    const before = parseCursor(request.nextUrl.searchParams.get("before"))
    const pinned = before
      ? []
      : await sql`
          SELECT id, user_id, body, pinned, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at FROM family_posts
          WHERE family_id = ${familyId} AND deleted_at IS NULL AND pinned = true
          ORDER BY created_at DESC
          LIMIT ${MAX_PINNED}
        `
    const rows = await sql`
      SELECT id, user_id, body, pinned, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at FROM family_posts
      WHERE family_id = ${familyId} AND deleted_at IS NULL AND pinned = false
        AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
      ORDER BY created_at DESC
      LIMIT ${PAGE_SIZE_POSTS + 1}
    `
    const hasMore = rows.length > PAGE_SIZE_POSTS
    const page = rows.slice(0, PAGE_SIZE_POSTS)
    const shaped = await shapePosts(familyId, [...pinned, ...page])
    return NextResponse.json({
      success: true,
      data: {
        pinned: shaped.slice(0, pinned.length),
        posts: shaped.slice(pinned.length),
        hasMore,
        nextBefore: hasMore ? page[page.length - 1].created_at : null,
        canModerate: access.canModerate,
        canPinFlyers: access.canPinFlyers,
      },
    })
  } catch (error) {
    console.error("Board GET error:", error)
    return NextResponse.json({ success: false, error: "Failed to load the board" }, { status: 500 })
  }
}

// POST - new post { body, pinned? }. Only a PARENT/owner may post it pinned.
export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardFlyerColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access

    const payload = await request.json().catch(() => ({}))
    const cleaned = cleanBody(payload.body, POST_MAX)
    if ("error" in cleaned) return NextResponse.json({ success: false, error: cleaned.error }, { status: 400 })
    if (await overRateLimit(user.id, "board")) {
      return NextResponse.json({ success: false, error: RATE_LIMIT_MESSAGE }, { status: 429 })
    }
    const pinned = payload.pinned === true && access.canModerate

    const id = crypto.randomUUID()
    const ins = await sql`
      INSERT INTO family_posts (id, family_id, user_id, body, pinned)
      VALUES (${id}, ${familyId}, ${user.id}, ${cleaned.body}, ${pinned})
      RETURNING id, user_id, body, pinned, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at
    `

    await notifyNewPost({ familyId, postId: id, user, role: access.role, pinned, body: cleaned.body })

    const [shaped] = await shapePosts(familyId, ins)
    return NextResponse.json({ success: true, data: shaped }, { status: 201 })
  } catch (error) {
    console.error("Board POST error:", error)
    return NextResponse.json({ success: false, error: "Failed to post" }, { status: 500 })
  }
}
