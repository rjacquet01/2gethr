import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { guestForbidden } from "@/lib/permissions"

// Last 24 hours of geofence arrivals/departures for a family's saved places.
// Parents/guardians see everyone's; any other member sees only their own.
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    }

    const familyId = request.nextUrl.searchParams.get("familyId") || user.primaryFamily?.id
    if (!familyId) {
      return NextResponse.json({ success: false, error: "No family specified" }, { status: 400 })
    }

    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `
    if (membership.length === 0) {
      return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
    }
    if (membership[0].role === "GUEST") return guestForbidden()

    // Everyone's arrivals/departures (children included) is a supervisor view;
    // ADULT members see their own, like children.
    const seesEveryone = ["PARENT", "GUARDIAN", "ADMIN"].includes(membership[0].role)

    const rows = seesEveryone
      ? await sql`
          SELECT ge.id, ge.event_type::text AS event_type, ge.timestamp, ge.user_id,
                 sp.id AS place_id, sp.name AS place_name, sp.color AS place_color,
                 u.first_name AS member_name
          FROM geofence_events ge
          JOIN saved_places sp ON sp.id = ge.saved_place_id
          JOIN users u ON u.id = ge.user_id
          JOIN family_members fm ON fm.user_id = ge.user_id AND fm.family_id = sp.family_id AND fm.is_active = true
          WHERE sp.family_id = ${familyId}
            AND ge.timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY ge.timestamp DESC
          LIMIT 100
        `
      : await sql`
          SELECT ge.id, ge.event_type::text AS event_type, ge.timestamp, ge.user_id,
                 sp.id AS place_id, sp.name AS place_name, sp.color AS place_color,
                 u.first_name AS member_name
          FROM geofence_events ge
          JOIN saved_places sp ON sp.id = ge.saved_place_id
          JOIN users u ON u.id = ge.user_id
          WHERE sp.family_id = ${familyId}
            AND ge.user_id = ${user.id}
            AND ge.timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY ge.timestamp DESC
          LIMIT 100
        `

    return NextResponse.json({
      success: true,
      data: {
        scope: seesEveryone ? "family" : "self",
        events: rows.map((r) => ({
          id: r.id,
          type: r.event_type === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL",
          at: r.timestamp,
          userId: r.user_id,
          memberName: r.member_name || "Family member",
          isMe: String(r.user_id) === String(user.id),
          placeId: r.place_id,
          placeName: r.place_name,
          placeColor: r.place_color,
        })),
      },
    })
  } catch (error) {
    console.error("Get geofence activity error:", error)
    return NextResponse.json({ success: false, error: "Failed to get geofence activity" }, { status: 500 })
  }
}
