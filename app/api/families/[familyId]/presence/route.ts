import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { getMemberAccess, guestForbidden } from "@/lib/permissions"
import { ONLINE_WINDOW_SECONDS, ensurePresenceColumn, touchPresence } from "@/lib/presence"

// GET - who in the family has had the app open recently. One small row per
// member: online if active in the last 5 minutes, plus when they were last
// active. Members only; guests don't get the family status strip.
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    const access = await getMemberAccess(familyId, user.id)
    if (!access) return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
    if (access.isGuest) return guestForbidden()

    await ensurePresenceColumn()
    // Asking counts as being here.
    await touchPresence(user.id)

    const rows = await sql`
      SELECT fm.user_id, u.last_active_at,
             (u.last_active_at > NOW() - make_interval(secs => ${ONLINE_WINDOW_SECONDS}::int)) AS online
      FROM family_members fm
      JOIN users u ON u.id = fm.user_id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true AND fm.user_id IS NOT NULL
      LIMIT 100
    `
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        userId: r.user_id as string,
        online: r.online === true,
        lastActiveAt: r.last_active_at ?? null,
      })),
    })
  } catch (error) {
    console.error("Family presence error:", error)
    return NextResponse.json({ success: false, error: "Failed to load presence" }, { status: 500 })
  }
}
