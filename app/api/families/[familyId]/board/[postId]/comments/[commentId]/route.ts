import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { ensureSocialTables } from "@/lib/social"

// DELETE - soft-delete a board comment: its author, or a PARENT / the family owner.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; postId: string; commentId: string }> }
) {
  try {
    const { familyId, postId, commentId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access

    const rows = await sql`
      SELECT user_id FROM family_post_comments
      WHERE id = ${commentId} AND post_id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL
      LIMIT 1
    `
    if (rows.length === 0) return NextResponse.json({ success: false, error: "Comment not found" }, { status: 404 })
    if (rows[0].user_id !== user.id && !access.canModerate) {
      return NextResponse.json({ success: false, error: "You can only delete your own comments" }, { status: 403 })
    }
    await sql`UPDATE family_post_comments SET deleted_at = NOW() WHERE id = ${commentId}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Board comment DELETE error:", error)
    return NextResponse.json({ success: false, error: "Failed to delete comment" }, { status: 500 })
  }
}
