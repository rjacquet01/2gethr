import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { flyerDownloadFilename, flyerStore } from "@/lib/board-flyers"
import { ensureBoardLimitColumns, expiryCutoff, isVisibleRow } from "@/lib/board-limits"
import { ensureSocialTables } from "@/lib/social"

export const runtime = "nodejs"

type Params = { params: Promise<{ familyId: string; postId: string }> }

const notFound = () => NextResponse.json({ success: false, error: "Flyer not found" }, { status: 404 })

// GET - save a flyer to your device: the full-size image as an attachment,
// for non-guest family members. Only posts on the board right now (not
// deleted, taken down or past their date). What's served is the stored
// copy, re-encoded at upload (lib/board-flyers processFlyerImage), so it
// never carries the original's EXIF/GPS data. Nothing is cached.
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { familyId, postId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardLimitColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access

    const rows = await sql`
      SELECT flyer_full_path, flyer_uploaded_at, taken_down_at, keep_up, expires_at
      FROM family_posts
      WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL AND flyer_full_path IS NOT NULL
      LIMIT 1
    `
    const post = rows[0]
    if (!post || !isVisibleRow(post, await expiryCutoff(familyId))) return notFound()

    const result = await flyerStore.get(post.flyer_full_path as string)
    if (!result || result.statusCode !== 200) return notFound()
    const contentType = result.blob.contentType || "image/jpeg"
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${flyerDownloadFilename(post.flyer_uploaded_at, contentType)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Board flyer download error:", error)
    return NextResponse.json({ success: false, error: "Could not download the flyer" }, { status: 500 })
  }
}
