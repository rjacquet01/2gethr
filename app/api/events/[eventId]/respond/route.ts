import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { z } from "zod"
import { actorNameInFamily } from "@/lib/member-names"

const schema = z.object({ action: z.enum(["ACCEPT", "DECLINE"]) })

// Invited participant accepts or declines an event (used for kid-to-kid invites).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

    const { action } = schema.parse(await request.json())
    const newStatus = action === "ACCEPT" ? "ACCEPTED" : "DECLINED"

    const rows = await sql`
      UPDATE event_participants
      SET status = ${newStatus}::participant_status, responded_at = NOW(), updated_at = NOW()
      WHERE event_id = ${eventId} AND user_id = ${user.id}
      RETURNING id
    `
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "You are not invited to this event" }, { status: 404 })
    }

    const ev = await sql`
      SELECT e.title, e.created_by_id, c.family_id FROM events e
      JOIN calendars c ON e.calendar_id = c.id WHERE e.id = ${eventId}
    `
    if (ev[0] && ev[0].created_by_id !== user.id) {
      const name = await actorNameInFamily(ev[0].family_id as string, user, "Someone")
      await createNotification({
        userId: ev[0].created_by_id,
        type: "APPROVAL_RESPONSE",
        title: action === "ACCEPT" ? "Invitation accepted" : "Invitation declined",
        body: `${name} ${action === "ACCEPT" ? "accepted" : "declined"} "${ev[0].title}"`,
        data: { eventId, familyId: ev[0].family_id },
      })
    }
    return NextResponse.json({ success: true, status: newStatus })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }
    console.error("Event respond error:", error)
    return NextResponse.json({ success: false, error: "Failed to respond" }, { status: 500 })
  }
}
