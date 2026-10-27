import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription } from "@/lib/auth"
import { guestForbidden } from "@/lib/permissions"
import { needsAccessGrant, hasApprovedAccess } from "@/lib/location-access"

// Trail of where a family member has been (for the route-history view).
// Parents/guardians may read any member who is sharing; everyone may read
// their own. Capped to the plan's history window and downsampled.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

    const sp = request.nextUrl.searchParams
    const memberId = sp.get("memberId")
    const familyId = sp.get("familyId") || user.primaryFamily?.id
    const hours = Math.min(Math.max(Number(sp.get("hours")) || 24, 1), 24 * 14)
    if (!memberId || !familyId) {
      return NextResponse.json({ success: false, error: "memberId and familyId are required" }, { status: 400 })
    }

    const me = await sql`
      SELECT id, role FROM family_members WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `
    if (me.length === 0) return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
    if (me[0].role === "GUEST") return guestForbidden()

    // Pings belong to the person, not the family, so visibility comes from
    // their membership in THIS family: a guest here is never readable here,
    // even if they share in a family of their own.
    const target = await sql`
      SELECT fm.user_id, fm.role, COALESCE(ls.share_with_family, false) AS share, COALESCE(ls.mode, 'OFF') AS mode
      FROM family_members fm
      LEFT JOIN location_settings ls ON ls.family_member_id = fm.id
      WHERE fm.id = ${memberId} AND fm.family_id = ${familyId} AND fm.is_active = true
        AND fm.role <> 'GUEST'
    `
    if (target.length === 0 || !target[0].user_id) {
      return NextResponse.json({ success: false, error: "Member not found" }, { status: 404 })
    }
    const isSelf = target[0].user_id === user.id
    // Reading a child's trail is a supervisor power (not ADULT). Another
    // grown-up's trail needs their approval, like their live location.
    const isAdult = me[0].role === "PARENT" || me[0].role === "GUARDIAN"
    if (!isSelf) {
      const grownUpTarget = needsAccessGrant(me[0].role, me[0].id, target[0].role, memberId)
      const allowed = grownUpTarget ? await hasApprovedAccess(me[0].id, memberId) : isAdult
      if (!allowed) return NextResponse.json({ success: false, error: "Not allowed" }, { status: 403 })
      if (!target[0].share || target[0].mode === "OFF") {
        return NextResponse.json({ success: false, error: "This member is not sharing their location" }, { status: 403 })
      }
    }

    const subscription = await checkFamilySubscription(familyId)
    if (!subscription.features.locationSharing) {
      return NextResponse.json({ success: false, error: "Location sharing requires a Premium subscription", code: "SUBSCRIPTION_REQUIRED" }, { status: 403 })
    }
    // The plan's location trail (Free 7 days), not its event history.
    const windowHours = Math.min(hours, Math.max(1, subscription.features.locationTrailDays || 1) * 24)

    const rows = await sql`
      SELECT latitude, longitude, speed, battery_level, timestamp
      FROM location_pings
      WHERE user_id = ${target[0].user_id}
        AND timestamp > NOW() - make_interval(hours => ${windowHours})
      ORDER BY timestamp ASC
      LIMIT 5000
    `
    // Downsample to ~600 points, always keeping the first and last.
    const step = Math.max(1, Math.ceil(rows.length / 600))
    const points = rows
      .filter((_, i) => i % step === 0 || i === rows.length - 1)
      .map((r) => ({
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        speed: r.speed != null ? Number(r.speed) : null,
        batteryLevel: r.battery_level != null ? Number(r.battery_level) : null,
        timestamp: r.timestamp,
      }))
    return NextResponse.json({ success: true, data: { hours: windowHours, points } })
  } catch (error) {
    console.error("Location history error:", error)
    return NextResponse.json({ success: false, error: "Failed to load history" }, { status: 500 })
  }
}
