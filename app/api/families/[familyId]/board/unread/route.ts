import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { ensureSocialTables } from "@/lib/social"

const CAP = 99

// GET - posts by others since the user last opened the board, capped at 99
// (the inner LIMIT keeps it bounded however long they've been away).
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access

    const rows = await sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT 1 FROM family_posts p
        WHERE p.family_id = ${familyId} AND p.deleted_at IS NULL AND p.user_id <> ${user.id}
          AND p.created_at > COALESCE(
            (SELECT board_last_seen_at FROM family_members WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true LIMIT 1),
            '-infinity'::timestamptz
          )
        ORDER BY p.created_at DESC
        LIMIT ${CAP}
      ) s
    `
    return NextResponse.json({ success: true, data: { unread: Math.min(Number(rows[0].n), CAP) } })
  } catch (error) {
    console.error("Board unread error:", error)
    return NextResponse.json({ success: false, error: "Failed to count" }, { status: 500 })
  }
}
