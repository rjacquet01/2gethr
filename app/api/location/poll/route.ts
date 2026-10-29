import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { verifyDeviceToken } from "@/lib/device-token"
import { hasPendingLocationRequest } from "@/lib/location-schema"
import { guestForbidden } from "@/lib/permissions"
import { boostPlacesForUser } from "@/lib/geofence-places"
import type { BoostPlace } from "@/lib/geofence"

// Cheap check the Android background service makes when nothing else has
// reached the server for a while (app 1.2.5+: 2 min, 5 min paused; older: 45 s):
// "should I be sharing, and has a parent asked for my location right now?"
// (requestPending can be true while sharing is false: answer it with one fix.)
// Authenticated with the same scoped device token as POST /api/location.
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-device-token")
  if (!token) return NextResponse.json({ success: false, error: "Missing device token" }, { status: 401 })
  const info = await verifyDeviceToken(token)
  if (!info) return NextResponse.json({ success: false, error: "Invalid or revoked device token" }, { status: 401 })

  const member = await sql`SELECT role FROM family_members WHERE id = ${info.memberId} AND is_active = true LIMIT 1`
  if (member[0]?.role === "GUEST") return guestForbidden()

  const rows = await sql`
    SELECT mode, share_with_family, update_interval_sec FROM location_settings
    WHERE family_member_id = ${info.memberId} LIMIT 1
  `
  const s = rows[0]
  const sharing = !!s && s.share_with_family === true && s.mode === "ACTIVE"
  // Also while sharing is off: a parent's ping to their child needs no
  // approval, and a fix sent now answers it as a one-time snapshot
  // (POST /api/location) without turning sharing on.
  let requestPending = false
  try {
    requestPending = await hasPendingLocationRequest(info.userId)
  } catch (err) {
    console.error("poll pending check failed:", err)
  }
  // While sharing: the places to switch on precise location near (app 1.2.10+).
  // Left out on an error, so the phone keeps the list it has.
  let places: BoostPlace[] | undefined = []
  if (sharing) {
    try {
      places = await boostPlacesForUser(info.userId)
    } catch (err) {
      console.error("poll places failed:", err)
      places = undefined
    }
  }
  return NextResponse.json({
    success: true,
    data: {
      sharing,
      requestPending,
      intervalSec: s?.update_interval_sec ?? 300,
      places,
    },
  })
}
