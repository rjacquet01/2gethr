import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getUserFromRequest } from "@/lib/auth"
import { boardAccess } from "@/lib/board"
import { ensureBoardLimitColumns, setKeepUp } from "@/lib/board-limits"
import { BOARD_LIMITS } from "@/lib/constants"
import { ensureSocialTables } from "@/lib/social"

const schema = z.object({ keepUp: z.boolean() })

// PUT { keepUp } - protect a pin from roll-off and event expiry, or stop.
// Parents, guardians and adults only; at most MAX_KEEP_UP per family.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ familyId: string; postId: string }> }) {
  try {
    const { familyId, postId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardLimitColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!access.canManagePins) {
      return NextResponse.json({ success: false, error: "Only parents, guardians and adults can keep pins up" }, { status: 403 })
    }
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ success: false, error: "Say whether to keep it up" }, { status: 400 })
    const result = await setKeepUp(familyId, postId, parsed.data.keepUp)
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, data: { ...result, max: BOARD_LIMITS.MAX_KEEP_UP } })
  } catch (error) {
    console.error("Board keep-up error:", error)
    return NextResponse.json({ success: false, error: "Could not update the pin" }, { status: 500 })
  }
}
