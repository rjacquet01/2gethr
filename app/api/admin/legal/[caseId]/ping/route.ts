import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { requireLegalAdmin, PERM_MANAGE, getCase, accessActive, legalLog, scopeUserIds } from "@/lib/legal"

const PING_MINUTES = 15
const MIN_GAP_MINUTES = 10

// Ask a covered person's phone for a fresh location. Highest bar in the system:
// the case must be active AND explicitly include live pings (emergency cases can).
// This uses the app's normal request channel, so it only works while the person's
// app is already sharing location. It never turns location on remotely.
export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const g = await requireLegalAdmin(request, PERM_MANAGE)
    if ("error" in g) return NextResponse.json({ success: false, error: g.error }, { status: g.status })
    const { caseId } = await params
    const c = await getCase(caseId)
    if (!c) return NextResponse.json({ success: false, error: "Case not found" }, { status: 404 })
    const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status })
    if (!accessActive(c)) return fail("No active approval for this case", 403)
    if (!c.includes_live_ping && c.type !== "EMERGENCY") return fail("This case was not approved for live pings", 403)

    const b = await request.json().catch(() => ({}))
    const ids = await scopeUserIds(c)
    const userId = String(b.userId || ids[0] || "")
    if (!ids.includes(userId)) return fail("That person isn't covered by this case")

    await ensureLocationRequestsTable()
    const recent = await sql`
      SELECT 1 FROM location_requests
      WHERE requester_user_id = ${"legal:" + caseId} AND target_user_id = ${userId}
        AND created_at > NOW() - make_interval(mins => ${MIN_GAP_MINUTES}::int) LIMIT 1
    `
    if (recent.length > 0) return fail(`A ping was already sent in the last ${MIN_GAP_MINUTES} minutes`, 429)

    const fam = await sql`
      SELECT fm.family_id, ls.mode, ls.share_with_family
      FROM family_members fm LEFT JOIN location_settings ls ON ls.family_member_id = fm.id
      WHERE fm.user_id = ${userId} AND fm.is_active = true
      ORDER BY (fm.family_id = ${c.scope_family_id || ""}) DESC LIMIT 1
    `
    if (fam.length === 0) return fail("That person has no active family membership")
    const sharing = fam[0].mode === "ACTIVE" && fam[0].share_with_family === true
    if (!sharing) {
      await legalLog(caseId, g.admin.id, "PING_NOT_SENT", { userId, reason: "location sharing is off" }, request)
      return fail("Their location sharing is off, so their phone won't answer a ping. Their most recent stored location is under Data > Location.", 409)
    }
    const id = `locreq_legal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    await sql`
      INSERT INTO location_requests (id, requester_user_id, target_user_id, family_id, status, created_at, expires_at)
      VALUES (${id}, ${"legal:" + caseId}, ${userId}, ${fam[0].family_id}, 'PENDING', NOW(), NOW() + make_interval(mins => ${PING_MINUTES}::int))
    `
    await legalLog(caseId, g.admin.id, "PING_SENT", { userId, requestId: id }, request)
    return NextResponse.json({ success: true, message: `Ping sent. If their phone is online it should report within a few minutes. Check Data > Location.` })
  } catch (e) {
    console.error("legal ping error:", e)
    return NextResponse.json({ success: false, error: "Ping failed" }, { status: 500 })
  }
}
