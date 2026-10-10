import { NextRequest, NextResponse } from "next/server"
import { ensureEventCategoryColumn } from "@/lib/event-category-column"
import { ensureTaskEventNotifyChannelsColumns } from "@/lib/notify-channels-schema"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { planGateError } from "@/lib/tier-gates"

const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  location: z.string().max(500).optional().nullable(),
  savedPlaceId: z.string().uuid().optional().nullable(),
  startTime: z.string().datetime({ offset: true }).optional(),
  endTime: z.string().datetime({ offset: true }).optional(),
  isAllDay: z.boolean().optional(),
  visibility: z.enum(["FAMILY", "PRIVATE", "SELECTED_MEMBERS"]).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  category: z.string().max(40).optional().nullable(),
  reminderMinutes: z.array(z.number().int().min(0)).optional(),
  notifyChannels: z.array(z.enum(["in_app", "push", "email", "sms"])).optional(),
  status: z.enum(["APPROVED", "CANCELLED"]).optional(),
})

// Get single event
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    await ensureEventCategoryColumn()
    await ensureTaskEventNotifyChannelsColumns()
    const { eventId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const events = await sql`
      SELECT 
        e.*,
        c.name as calendar_name, c.color as calendar_color, c.family_id,
        u.first_name as creator_first_name, u.last_name as creator_last_name,
        sp.name as place_name, sp.address as place_address, sp.latitude, sp.longitude,
        rr.frequency, rr.interval, rr.days_of_week, rr.day_of_month, 
        rr.month_of_year, rr.end_date as recurrence_end_date, rr.occurrence_count
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      JOIN users u ON e.created_by_id = u.id
      JOIN family_members fm ON c.family_id = fm.family_id AND fm.user_id = ${user.id}
      LEFT JOIN saved_places sp ON e.saved_place_id = sp.id
      LEFT JOIN recurrence_rules rr ON e.recurrence_rule_id = rr.id
      WHERE e.id = ${eventId} AND fm.is_active = true
    `

    if (events.length === 0) {
      return NextResponse.json(
        { success: false, error: "Event not found or access denied" },
        { status: 404 }
      )
    }

    const event = events[0]

    // Get participants
    const participants = await sql`
      SELECT 
        ep.id, ep.user_id, ep.status, ep.responded_at,
        u.first_name, u.last_name, u.email
      FROM event_participants ep
      JOIN users u ON ep.user_id = u.id
      WHERE ep.event_id = ${eventId}
    `

    // Get event request if pending
    let eventRequest = null
    if (event.status === "PENDING") {
      const requests = await sql`
        SELECT er.*, u.first_name as requestor_first_name, u.last_name as requestor_last_name
        FROM event_requests er
        JOIN users u ON er.requestor_id = u.id
        WHERE er.event_id = ${eventId}
        ORDER BY er.requested_at DESC
        LIMIT 1
      `
      if (requests.length > 0) {
        eventRequest = {
          id: requests[0].id,
          status: requests[0].status,
          requestNotes: requests[0].request_notes,
          responseNotes: requests[0].response_notes,
          requestedAt: requests[0].requested_at,
          respondedAt: requests[0].responded_at,
          requestorName: `${requests[0].requestor_first_name} ${requests[0].requestor_last_name}`,
        }
      }
    }

    return NextResponse.json({
      success: true,
      event: {
        id: event.id,
        calendarId: event.calendar_id,
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.start_time,
        endTime: event.end_time,
        isAllDay: event.is_all_day,
        allDay: event.is_all_day, // alias for frontend compatibility
        status: event.status,
        visibility: event.visibility,
        color: event.color || event.calendar_color,
        customColor: event.color || null,
        category: event.category || 'OTHER',
        reminderMinutes: event.reminder_minutes,
        notifyChannels: event.notify_channels || [],
        isRecurring: event.is_recurring,
        recurrenceId: event.recurrence_rule_id, // alias for frontend compatibility
        createdById: event.created_by_id,
        isOwner: event.created_by_id === user.id,
        creatorName: `${event.creator_first_name} ${event.creator_last_name}`,
        calendar: {
          id: event.calendar_id,
          name: event.calendar_name,
          color: event.calendar_color,
          familyId: event.family_id,
        },
        savedPlace: event.saved_place_id ? {
          id: event.saved_place_id,
          name: event.place_name,
          address: event.place_address,
          latitude: event.latitude,
          longitude: event.longitude,
        } : null,
        recurrence: event.is_recurring ? {
          frequency: event.frequency,
          interval: event.interval,
          daysOfWeek: event.days_of_week,
          dayOfMonth: event.day_of_month,
          monthOfYear: event.month_of_year,
          endDate: event.recurrence_end_date,
          occurrenceCount: event.occurrence_count,
        } : null,
        participants: participants.map(p => ({
          id: p.id,
          userId: p.user_id,
          status: p.status,
          respondedAt: p.responded_at,
          name: `${p.first_name} ${p.last_name}`,
          displayName: `${p.first_name} ${p.last_name}`,
          email: p.email,
        })),
        eventRequest,
        createdAt: event.created_at,
        updatedAt: event.updated_at,
      },
    })
  } catch (error) {
    console.error("Get event error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get event" },
      { status: 500 }
    )
  }
}

// Update event
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    await ensureEventCategoryColumn()
    await ensureTaskEventNotifyChannelsColumns()
    const { eventId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Get event and check permissions
    const events = await sql`
      SELECT e.*, fm.role, fm.can_create_events
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
    const isOwner = event.created_by_id === user.id
    const isParent = event.role === "PARENT"

    // Only owner or parent can update
    if (!isOwner && !isParent) {
      return NextResponse.json(
        { success: false, error: "You don't have permission to update this event" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = updateEventSchema.parse(body)

    if (validatedData.reminderMinutes) {
      const cal = await sql`SELECT family_id FROM calendars WHERE id = ${event.calendar_id}`
      if (cal.length > 0) {
        const gateError = await planGateError(cal[0].family_id, { reminderMinutes: validatedData.reminderMinutes })
        if (gateError) {
          return NextResponse.json({ success: false, error: gateError }, { status: 403 })
        }
      }
    }

    // Update event
    await sql`
      UPDATE events SET
        title = COALESCE(${validatedData.title}, title),
        description = CASE WHEN ${validatedData.description !== undefined} THEN ${validatedData.description} ELSE description END,
        location = CASE WHEN ${validatedData.location !== undefined} THEN ${validatedData.location} ELSE location END,
        saved_place_id = CASE WHEN ${validatedData.savedPlaceId !== undefined} THEN ${validatedData.savedPlaceId} ELSE saved_place_id END,
        start_time = COALESCE(${validatedData.startTime}, start_time),
        end_time = COALESCE(${validatedData.endTime}, end_time),
        is_all_day = COALESCE(${validatedData.isAllDay}, is_all_day),
        visibility = COALESCE(${validatedData.visibility}, visibility),
        color = CASE WHEN ${validatedData.color !== undefined} THEN ${validatedData.color} ELSE color END,
        category = CASE WHEN ${validatedData.category !== undefined} THEN ${validatedData.category ? validatedData.category.replace(/\s+/g, ' ').trim().slice(0, 30) || null : null} ELSE category END,
        reminder_minutes = COALESCE(${validatedData.reminderMinutes}, reminder_minutes),
        notify_channels = CASE WHEN ${validatedData.notifyChannels !== undefined} THEN ${validatedData.notifyChannels && validatedData.notifyChannels.length > 0 ? validatedData.notifyChannels : null}::text[] ELSE notify_channels END,
        status = COALESCE(${validatedData.status}, status),
        updated_at = NOW()
      WHERE id = ${eventId}
    `

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "event", eventId, {
      oldValue: { title: event.title, status: event.status },
      newValue: validatedData as Record<string, unknown>,
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Event updated successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Update event error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update event" },
      { status: 500 }
    )
  }
}

// Delete event
export async function DELETE(
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

    // Get event and check permissions
    const events = await sql`
      SELECT e.*, fm.role
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
    const isOwner = event.created_by_id === user.id
    const isParent = event.role === "PARENT"

    if (!isOwner && !isParent) {
      return NextResponse.json(
        { success: false, error: "You don't have permission to delete this event" },
        { status: 403 }
      )
    }

    // Soft delete - set status to CANCELLED
    await sql`
      UPDATE events SET status = 'CANCELLED', updated_at = NOW()
      WHERE id = ${eventId}
    `

    // Audit log
    await logAuditEvent(user.id, "DELETE", "event", eventId, {
      oldValue: { title: event.title },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Event deleted successfully",
    })
  } catch (error) {
    console.error("Delete event error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to delete event" },
      { status: 500 }
    )
  }
}
