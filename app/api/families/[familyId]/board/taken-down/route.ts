import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { ensureBoardLimitColumns, listTakenDown } from "@/lib/board-limits"
import { BOARD_LIMITS } from "@/lib/constants"
import { ensureSocialTables } from "@/lib/social"

// GET - pins taken down in the last RESTORE_DAYS (made room, or event over),
// most recent first. Parents, guardians and adults only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardLimitColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!access.canManagePins) {
      return NextResponse.json({ success: false, error: "Only parents, guardians and adults can see taken-down pins" }, { status: 403 })
    }
    const pins = await listTakenDown(familyId)
    return NextResponse.json({ success: true, data: { pins, restoreDays: BOARD_LIMITS.RESTORE_DAYS } })
  } catch (error) {
    console.error("Board taken-down GET error:", error)
    return NextResponse.json({ success: false, error: "Failed to load taken-down pins" }, { status: 500 })
  }
}
