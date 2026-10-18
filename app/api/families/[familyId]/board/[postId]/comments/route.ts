import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess, shapeComment, type BoardAccess } from "@/lib/board"
import { ensureBoardLimitColumns, expiryCutoff, isVisibleRow } from "@/lib/board-limits"
import {
  PAGE_SIZE_COMMENTS,
  POST_COMMENT_MAX,
  RATE_LIMIT_MESSAGE,
  authorInfo,
  cleanBody,
  ensureSocialTables,
  overRateLimit,
  parseCursor,
} from "@/lib/social"

// A taken-down pin's replies are for adults only (kids never see it).
async function postExists(familyId: string, postId: string, access: BoardAccess) {
  await ensureBoardLimitColumns()
  const rows = await sql`
    SELECT taken_down_at, keep_up, expires_at FROM family_posts
    WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL LIMIT 1
  `
  if (!rows[0]) return false
  return access.canManagePins || isVisibleRow(rows[0], await expiryCutoff(familyId))
}

// GET - comments on a post, oldest first: latest 50, ?before= pages back,
// ?since= returns only newer ones.
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string; postId: string }> }) {
  try {
    const { familyId, postId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!(await postExists(familyId, postId, access))) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 })

    const before = parseCursor(request.nextUrl.searchParams.get("before"))
    const since = parseCursor(request.nextUrl.searchParams.get("since"))
    const rows = await sql`
      SELECT id, user_id, body, created_at FROM family_post_comments
      WHERE post_id = ${postId} AND deleted_at IS NULL
        AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
        AND (${since}::timestamptz IS NULL OR created_at > ${since}::timestamptz)
      ORDER BY created_at DESC
      LIMIT ${PAGE_SIZE_COMMENTS + 1}
    `
    const hasMore = rows.length > PAGE_SIZE_COMMENTS
    const page = rows.slice(0, PAGE_SIZE_COMMENTS).reverse()
    const authors = await authorInfo(familyId, page.map((r) => r.user_id as string))
    return NextResponse.json({ success: true, data: page.map((r) => shapeComment(r, authors)), hasMore })
  } catch (error) {
    console.error("Board comments GET error:", error)
    return NextResponse.json({ success: false, error: "Failed to load comments" }, { status: 500 })
  }
}

// POST - comment on a post { body }. Comments don't notify anyone.
export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string; postId: string }> }) {
  try {
    const { familyId, postId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!(await postExists(familyId, postId, access))) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 })

    const payload = await request.json().catch(() => ({}))
    const cleaned = cleanBody(payload.body, POST_COMMENT_MAX)
    if ("error" in cleaned) return NextResponse.json({ success: false, error: cleaned.error }, { status: 400 })
    if (await overRateLimit(user.id, "board")) {
      return NextResponse.json({ success: false, error: RATE_LIMIT_MESSAGE }, { status: 429 })
    }

    const ins = await sql`
      INSERT INTO family_post_comments (id, post_id, family_id, user_id, body)
      VALUES (${crypto.randomUUID()}, ${postId}, ${familyId}, ${user.id}, ${cleaned.body})
      RETURNING id, user_id, body, created_at
    `
    const authors = await authorInfo(familyId, [user.id])
    return NextResponse.json({ success: true, data: shapeComment(ins[0], authors) }, { status: 201 })
  } catch (error) {
    console.error("Board comments POST error:", error)
    return NextResponse.json({ success: false, error: "Failed to comment" }, { status: 500 })
  }
}
