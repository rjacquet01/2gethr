import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { ensureSocialTables } from "@/lib/social"

// POST - the user has looked at the board: clears their unread count.
export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access

    await sql`
      UPDATE family_members SET board_last_seen_at = NOW()
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Board seen error:", error)
    return NextResponse.json({ success: false, error: "Failed to update" }, { status: 500 })
  }
}
