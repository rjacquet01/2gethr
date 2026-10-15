import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { eventCommentAccess } from "@/lib/event-comment-access"
import { ensureSocialTables } from "@/lib/social"

// DELETE - soft-delete a comment: its author, or a PARENT / the family owner.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string; commentId: string }> }
) {
  try {
    const { eventId, commentId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await eventCommentAccess(eventId, user.id)
    if (!access) return NextResponse.json({ success: false, error: "Event not found" }, { status: 404 })

    const rows = await sql`
      SELECT user_id FROM event_comments
      WHERE id = ${commentId} AND event_id = ${eventId} AND deleted_at IS NULL
      LIMIT 1
    `
    if (rows.length === 0) return NextResponse.json({ success: false, error: "Comment not found" }, { status: 404 })
    const canModerate = access.role === "PARENT" || access.isOwner
    if (rows[0].user_id !== user.id && !canModerate) {
      return NextResponse.json({ success: false, error: "You can only delete your own comments" }, { status: 403 })
    }

    await sql`UPDATE event_comments SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${commentId}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Event comment DELETE error:", error)
    return NextResponse.json({ success: false, error: "Failed to delete comment" }, { status: 500 })
  }
}
