import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { ensureBoardLimitColumns, restorePin } from "@/lib/board-limits"
import { ensureSocialTables } from "@/lib/social"

// POST - put a taken-down pin back on the board (within RESTORE_DAYS).
// Parents, guardians and adults only. A full board takes down its oldest
// unprotected pin instead; the response lists it (rolledOff).
export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string; postId: string }> }) {
  try {
    const { familyId, postId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardLimitColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!access.canManagePins) {
      return NextResponse.json({ success: false, error: "Only parents, guardians and adults can restore pins" }, { status: 403 })
    }
    const result = await restorePin(familyId, postId)
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, data: { id: postId }, rolledOff: result.rolledOff })
  } catch (error) {
    console.error("Board restore error:", error)
    return NextResponse.json({ success: false, error: "Could not restore the pin" }, { status: 500 })
  }
}
