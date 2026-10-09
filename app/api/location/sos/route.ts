import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { verifyDeviceToken } from "@/lib/device-token"
import { getUserFromRequest, getUserWithFamily } from "@/lib/auth"
import { dispatchSos, ensureSosSchema } from "@/lib/sos"
import { z } from "zod"

export const maxDuration = 30

const schema = z.object({
  familyId: z.string().min(1).optional(),
  message: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
})

// "I need help": immediately alerts every parent/guardian in the family on
// all channels (push, text, email, in-app) with a map link to the sender's
// most recent location. Works from the web app (session) or the Android
// background service (device token).
export async function POST(request: NextRequest) {
  try {
    const deviceToken = request.headers.get("x-device-token")
    let userId: string | null = null
    let familyIdFromToken: string | null = null
    if (deviceToken) {
      const info = await verifyDeviceToken(deviceToken)
      if (info) {
        userId = info.userId
        familyIdFromToken = info.familyId
      }
    } else {
      const { user } = await getUserFromRequest(request)
      userId = user?.id ?? null
    }
    if (!userId) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

    const body = schema.parse(await request.json().catch(() => ({})))
    const familyId = familyIdFromToken || body.familyId || (await getUserWithFamily(userId))?.primaryFamily?.id
    if (!familyId) return NextResponse.json({ success: false, error: "No family" }, { status: 400 })

    const member = await sql`
      SELECT fm.id FROM family_members fm
      WHERE fm.family_id = ${familyId} AND fm.user_id = ${userId} AND fm.is_active = true
    `
    if (member.length === 0) return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })

    let lat: number | null = body.latitude ?? null
    let lng: number | null = body.longitude ?? null
    let locationNote = "live GPS"
    let source = "device"
    if (lat == null || lng == null) {
      lat = null
      lng = null
      const last = await sql`
        SELECT latitude, longitude, timestamp FROM location_pings WHERE user_id = ${userId} ORDER BY timestamp DESC LIMIT 1
      `
      if (last[0]) {
        lat = Number(last[0].latitude)
        lng = Number(last[0].longitude)
        const mins = Math.max(0, Math.round((Date.now() - new Date(last[0].timestamp).getTime()) / 60000))
        locationNote = mins < 2 ? "just now" : mins < 120 ? `last known, ${mins} min ago` : `last known, ${Math.round(mins / 60)} h ago`
        source = "last_ping"
      } else {
        source = "none"
      }
    }
    const who = (await sql`SELECT first_name FROM users WHERE id = ${userId}`)[0]?.first_name || "A family member"

    await ensureSosSchema()
    const eventId = `sos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    await sql`
      INSERT INTO sos_events (id, user_id, family_id, latitude, longitude, location_source, message)
      VALUES (${eventId}, ${userId}, ${familyId}, ${lat}, ${lng}, ${source}, ${body.message ?? null})
    `
    const results = await dispatchSos({
      eventId, familyId, senderId: userId, senderName: who,
      latitude: lat, longitude: lng, locationNote, message: body.message,
    })
    const reached = results.filter((r) => r.sms === "sent" || r.push === "sent" || r.email === "sent").length
    return NextResponse.json({
      success: true,
      data: {
        notified: results.length,
        reached,
        hasLocation: lat != null && lng != null,
        locationNote,
        recipients: results,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }
    console.error("SOS error:", error)
    return NextResponse.json({ success: false, error: "Failed to send SOS" }, { status: 500 })
  }
}
