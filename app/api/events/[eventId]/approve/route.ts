import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { createNotification } from "@/lib/notifications"
import { guestCanSeeEvent } from "@/lib/guest-scope"

const approvalSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  responseNotes: z.string().max(500).optional(),
})

// Approve or reject an event (parent only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Get event and verify parent access
    const events = await sql`
      SELECT e.id, e.title, e.status, e.created_by_id, e.recurrence_rule_id, fm.role, c.family_id
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      JOIN family_members fm ON c.family_id = fm.family_id AND fm.user_id = ${user.id}
      WHERE e.id = ${eventId} AND fm.is_active = true
    `

    if (events.length === 0) {
      return NextResponse.json(
        { success: false, error: "Event not found or access denied" },
        { status: 404 }
      )
    }

    const event = events[0]

    // Guests can't approve anything; an event they can't see is simply not found.
    if (event.role === "GUEST" && !(await guestCanSeeEvent(user.id, eventId))) {
      return NextResponse.json(
        { success: false, error: "Event not found or access denied" },
        { status: 404 }
      )
    }

    if (event.role !== "PARENT" && event.role !== "GUARDIAN") {
      return NextResponse.json(
        { success: false, error: "Only parents and guardians can approve or reject events" },
        { status: 403 }
      )
    }

    if (event.status !== "PENDING") {
      return NextResponse.json(
        { success: false, error: "Event is not pending approval" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { action, responseNotes } = approvalSchema.parse(body)

    const newStatus = action === "APPROVE" ? "APPROVED" : "REJECTED"

    // A repeating request is one decision: every occurrence still waiting in
    // the series gets it (each had its own PENDING request, and only this one
    // was ever shown to the parent). Only PENDING ones change.
    const decided = event.recurrence_rule_id
      ? await sql`
          UPDATE events SET status = ${newStatus}, updated_at = NOW()
          WHERE recurrence_rule_id = ${event.recurrence_rule_id} AND calendar_id = (SELECT calendar_id FROM events WHERE id = ${eventId})
            AND status = 'PENDING'
          RETURNING id
        `
      : await sql`
          UPDATE events SET status = ${newStatus}, updated_at = NOW()
          WHERE id = ${eventId} AND status = 'PENDING'
          RETURNING id
        `
    const decidedIds = decided.map((r) => r.id as string)
    if (decidedIds.length === 0) {
      // Another parent decided a moment ago.
      return NextResponse.json(
        { success: false, error: "Event is not pending approval" },
        { status: 409 }
      )
    }

    await sql`
      UPDATE event_requests
      SET
        status = ${action === "APPROVE" ? "APPROVED" : "REJECTED"},
        approver_id = ${user.id},
        response_notes = ${responseNotes || null},
        responded_at = NOW()
      WHERE event_id = ANY(${decidedIds}) AND status = 'PENDING'
    `

    // Tell the creator (in-app + push + their chosen channels). The old
    // direct INSERT used type 'EVENT_APPROVAL', which is not in the
    // notification_type enum.
    await createNotification({
      userId: event.created_by_id,
      type: action === "APPROVE" ? "EVENT_APPROVED" : "EVENT_REJECTED",
      title: action === "APPROVE" ? "Event Approved" : "Event Rejected",
      body: action === "APPROVE"
        ? `Your event "${event.title}" has been approved.`
        : `Your event "${event.title}" was not approved.${responseNotes ? ` Reason: ${responseNotes}` : ""}`,
      data: { eventId, action, familyId: event.family_id },
      sendEmail: true,
    })
    if (action === "APPROVE") {
      const invitees = await sql`
        SELECT user_id FROM event_participants
        WHERE event_id = ${eventId} AND user_id <> ${event.created_by_id} AND user_id <> ${user.id}
      `
      for (const inv of invitees) {
        await createNotification({
          userId: inv.user_id,
          type: "EVENT_INVITATION",
          title: "Event invitation",
          body: `You're invited to "${event.title}".`,
          data: { eventId, familyId: event.family_id },
        })
      }
    }

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "event_approval", eventId, {
      newValue: { action, newStatus, responseNotes },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: action === "APPROVE" ? "Event approved" : "Event rejected",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Event approval error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to process event approval" },
      { status: 500 }
    )
  }
}
