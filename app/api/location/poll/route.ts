import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { verifyDeviceToken } from "@/lib/device-token"
import { hasPendingLocationRequest } from "@/lib/location-schema"

// Cheap check the Android background service makes every minute or so:
// "should I be sharing, and has a parent asked for my location right now?"
// Authenticated with the same scoped device token as POST /api/location.
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-device-token")
  if (!token) return NextResponse.json({ success: false, error: "Missing device token" }, { status: 401 })
  const info = await verifyDeviceToken(token)
  if (!info) return NextResponse.json({ success: false, error: "Invalid or revoked device token" }, { status: 401 })

  const rows = await sql`
    SELECT mode, share_with_family, update_interval_sec FROM location_settings
    WHERE family_member_id = ${info.memberId} LIMIT 1
  `
  const s = rows[0]
  const sharing = !!s && s.share_with_family === true && s.mode === "ACTIVE"
  let requestPending = false
  if (sharing) {
    try {
      requestPending = await hasPendingLocationRequest(info.userId)
    } catch (err) {
      console.error("poll pending check failed:", err)
    }
  }
  return NextResponse.json({
    success: true,
    data: {
      sharing,
      requestPending,
      intervalSec: s?.update_interval_sec ?? 300,
    },
  })
}
