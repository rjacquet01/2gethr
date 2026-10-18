import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { ensureSocialTables } from "@/lib/social"
import { clearFlyerColumns, deleteFlyerFiles, ensureBoardFlyerColumns } from "@/lib/board-flyers"

async function loadPost(familyId: string, postId: string) {
  const rows = await sql`
    SELECT id, user_id, flyer_full_url, flyer_thumb_url FROM family_posts
    WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL
    LIMIT 1
  `
  return rows[0] || null
}

// DELETE - soft-delete a post: its author, or a PARENT / the family owner.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ familyId: string; postId: string }> }) {
  try {
    const { familyId, postId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardFlyerColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access

    const post = await loadPost(familyId, postId)
    if (!post) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 })
    if (post.user_id !== user.id && !access.canModerate) {
      return NextResponse.json({ success: false, error: "You can only delete your own posts" }, { status: 403 })
    }
    await sql`UPDATE family_posts SET deleted_at = NOW() WHERE id = ${postId}`
    // The flyer's files go now; the row itself is purged after 30 days.
    // (Photos are never disclosed in legal requests, so a hold doesn't keep them.)
    if (post.flyer_full_url) {
      const done = await deleteFlyerFiles([post as { id: string; flyer_full_url: string; flyer_thumb_url: string | null }])
      await clearFlyerColumns([...done])
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Board post DELETE error:", error)
    return NextResponse.json({ success: false, error: "Failed to delete post" }, { status: 500 })
  }
}

const patchSchema = z.object({ pinned: z.boolean() })

// PATCH - pin or unpin { pinned } (PARENT / the family owner only).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ familyId: string; postId: string }> }) {
  try {
    const { familyId, postId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardFlyerColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!access.canModerate) {
      return NextResponse.json({ success: false, error: "Only a parent can pin posts" }, { status: 403 })
    }

    const { pinned } = patchSchema.parse(await request.json())
    const post = await loadPost(familyId, postId)
    if (!post) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 })
    await sql`UPDATE family_posts SET pinned = ${pinned} WHERE id = ${postId}`
    return NextResponse.json({ success: true, data: { pinned } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Board post PATCH error:", error)
    return NextResponse.json({ success: false, error: "Failed to update post" }, { status: 500 })
  }
}
