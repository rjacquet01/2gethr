import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { getDeviceTokenStatus } from "@/lib/device-token"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { APPROVED_WINDOW_MINUTES, PING_WINDOW_MINUTES } from "@/lib/location-approval"
import { guestForbidden } from "@/lib/permissions"

// "Share now" inside the Android app. Chrome there won't hand the page a
// location, so ask this phone's own background service for a fresh fix: an
// open PENDING request to yourself, which the service sees on its next check
// (within ~2 minutes) and answers like a parent's "Request location".
const SELF_REFRESH_LIMIT = 10

export async function POST(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const memberId = typeof body.memberId === "string" ? body.memberId : null
  const familyId = typeof body.familyId === "string" ? body.familyId : null
  if (!memberId || !familyId) return NextResponse.json({ error: "Member not found" }, { status: 404 })
  const rows = await sql`
    SELECT id, role FROM family_members
    WHERE id = ${memberId} AND family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    LIMIT 1
  `
  if (rows.length === 0) return NextResponse.json({ error: "Member not found" }, { status: 404 })
  if (rows[0].role === "GUEST") return guestForbidden()

  const status = await getDeviceTokenStatus(user.id, memberId)
  if (!status.active) {
    return NextResponse.json({ error: "Background sharing is off on this phone", code: "NO_BACKGROUND" }, { status: 409 })
  }

  await ensureLocationRequestsTable()
  const recent = await sql`
    SELECT COUNT(*)::int AS n FROM location_requests
    WHERE requester_user_id = ${user.id} AND target_user_id = ${user.id}
      AND created_at > NOW() - make_interval(mins => ${PING_WINDOW_MINUTES}::int)
  `
  if (Number(recent[0]?.n ?? 0) >= SELF_REFRESH_LIMIT) {
    return NextResponse.json(
      { error: "You've refreshed a lot in the last hour. Your phone keeps sharing on its own.", code: "COOLDOWN" },
      { status: 429 }
    )
  }

  const id = `locreq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  await sql`
    INSERT INTO location_requests (id, requester_user_id, target_user_id, family_id, status, created_at, expires_at)
    VALUES (
      ${id}, ${user.id}, ${user.id}, ${familyId},
      'PENDING', NOW(), NOW() + make_interval(mins => ${APPROVED_WINDOW_MINUTES}::int)
    )
  `
  return NextResponse.json({ success: true, lastSeenAt: status.lastSeenAt })
}
