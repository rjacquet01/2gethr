import { ensureEventParticipantChildColumns, resolveLoginlessChildIds, addEventParticipants, notifyParticipantsAdded } from "@/lib/assignment"
import { NextRequest, NextResponse } from "next/server"
import { ensureEventCategoryColumn } from "@/lib/event-category-column"
import { ensureTaskEventNotifyChannelsColumns } from "@/lib/notify-channels-schema"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { planGateError } from "@/lib/tier-gates"
import { guestCanSeeEvent, canSeeEventVisibility } from "@/lib/guest-scope"

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
  // Full replacement list of invited family members (user ids).
  participantUserIds: z.array(z.string()).optional(),
  // Full replacement list of invited children who have no login.
  participantChildProfileIds: z.array(z.string()).optional(),
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
        c.name as calendar_name, c.color as calendar_color, c.family_id, fm.role as member_role,
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
    // Guests only reach events they created or were invited to.
    const viewerIsGuest = event.member_role === "GUEST"
    if (viewerIsGuest && !(await guestCanSeeEvent(user.id, eventId))) {
      return NextResponse.json(
        { success: false, error: "Event not found or access denied" },
        { status: 404 }
      )
    }
    // PRIVATE / SELECTED_MEMBERS events only reach their creator and participants.
    if (!(await canSeeEventVisibility(event as { id: string; visibility?: unknown; created_by_id?: unknown }, user.id))) {
      return NextResponse.json(
        { success: false, error: "Event not found or access denied" },
        { status: 404 }
      )
    }

    // Get participants
    await ensureEventParticipantChildColumns()
    const participants = await sql`
      SELECT 
        ep.id, ep.user_id, ep.child_profile_id, ep.status, ep.responded_at,
        u.first_name, u.last_name, u.email, cp.display_name AS child_name
      FROM event_participants ep
      LEFT JOIN users u ON ep.user_id = u.id
      LEFT JOIN child_profiles cp ON ep.child_profile_id = cp.id
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
        // Same rule as PATCH and DELETE below: the creator or a parent.
        canManage: event.created_by_id === user.id || event.member_role === "PARENT",
        creatorName: `${event.creator_first_name} ${event.creator_last_name}`,
        calendar: {
          id: event.calendar_id,
          name: event.calendar_name,
          color: event.calendar_color,
          familyId: event.family_id,
        },
        // Guests get the place name only, never its address or coordinates.
        savedPlace: event.saved_place_id ? {
          id: event.saved_place_id,
          name: event.place_name,
          address: viewerIsGuest ? null : event.place_address,
          latitude: viewerIsGuest ? null : event.latitude,
          longitude: viewerIsGuest ? null : event.longitude,
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
          childProfileId: p.child_profile_id,
          status: p.status,
          respondedAt: p.responded_at,
          name: p.child_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          displayName: p.child_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          email: p.email || null,
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
    if (event.role === "GUEST" && !(await guestCanSeeEvent(user.id, eventId))) {
      return NextResponse.json(
        { success: false, error: "Event not found or access denied" },
        { status: 404 }
      )
    }
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
    const newStart = new Date(validatedData.startTime ?? event.start_time)
    const newEnd = new Date(validatedData.endTime ?? event.end_time)
    if (newEnd < newStart) {
      return NextResponse.json({ success: false, error: "The event can't end before it starts" }, { status: 400 })
    }

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

    // A guest editing their own event can keep who is already on it and add
    // themselves, but can't add anyone else from the family.
    if (event.role === "GUEST" && (validatedData.participantUserIds || validatedData.participantChildProfileIds)) {
      const current = await sql`
        SELECT user_id, child_profile_id FROM event_participants WHERE event_id = ${eventId}
      `
      const okUsers = new Set([user.id, ...current.map((p) => p.user_id as string).filter(Boolean)])
      const okChildren = new Set(current.map((p) => p.child_profile_id as string).filter(Boolean))
      const addsOthers =
        (validatedData.participantUserIds || []).some((id) => !okUsers.has(id)) ||
        (validatedData.participantChildProfileIds || []).some((id) => !okChildren.has(id))
      if (addsOthers) {
        return NextResponse.json(
          { success: false, error: "Guests can only add themselves to an event" },
          { status: 403 }
        )
      }
    }

    // Replace the invited members (only real, active members of this family),
    // then tell whoever was newly added.
    if (validatedData.participantUserIds || validatedData.participantChildProfileIds) {
      await ensureEventParticipantChildColumns()
      const cal = await sql`SELECT family_id FROM calendars WHERE id = ${event.calendar_id}`
      const familyId = cal.length === 0 ? null : (cal[0].family_id as string)
      let addedUserIds: string[] = []
      let addedChildIds: string[] = []

      if (familyId && validatedData.participantUserIds) {
        const valid = await sql`
          SELECT DISTINCT user_id FROM family_members
          WHERE family_id = ${familyId} AND is_active = true
          AND user_id = ANY(${validatedData.participantUserIds}::text[])
        `
        const keep = valid.map((m) => m.user_id as string)
        await sql`DELETE FROM event_participants WHERE event_id = ${eventId} AND user_id IS NOT NULL AND NOT (user_id = ANY(${keep}::text[]))`
        const added = await addEventParticipants(eventId, keep, [])
        addedUserIds = added.addedUserIds
      }
      if (familyId && validatedData.participantChildProfileIds) {
        const keepChildren = await resolveLoginlessChildIds(familyId, validatedData.participantChildProfileIds)
        await sql`DELETE FROM event_participants WHERE event_id = ${eventId} AND child_profile_id IS NOT NULL AND NOT (child_profile_id = ANY(${keepChildren}::text[]))`
        const added = await addEventParticipants(eventId, [], keepChildren)
        addedChildIds = added.addedChildIds
      }

      if (familyId && (addedUserIds.length > 0 || addedChildIds.length > 0)) {
        try {
          const actorName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'A family member'
          await notifyParticipantsAdded({
            eventId,
            familyId,
            title: validatedData.title || event.title,
            actorUserId: user.id,
            actorName,
            actorRole: event.role,
            addedUserIds,
            addedChildIds,
            channels: validatedData.notifyChannels && validatedData.notifyChannels.length > 0
              ? validatedData.notifyChannels
              : (event.notify_channels && event.notify_channels.length > 0 ? event.notify_channels : undefined),
          })
        } catch (notifyErr) {
          console.error("Notify added participants failed:", notifyErr)
        }
      }
    }

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
    if (event.role === "GUEST" && !(await guestCanSeeEvent(user.id, eventId))) {
      return NextResponse.json(
        { success: false, error: "Event not found or access denied" },
        { status: 404 }
      )
    }
    const isOwner = event.created_by_id === user.id
    const isParent = event.role === "PARENT"

    if (!isOwner && !isParent) {
      return NextResponse.json(
        { success: false, error: "You don't have permission to delete this event" },
        { status: 403 }
      )
    }

    // Soft delete - set status to CANCELLED. "All occurrences" cancels every
    // event of the same recurring series (they share recurrence_rule_id).
    const allOccurrences = request.nextUrl.searchParams.get("deleteRecurrence") === "true"
    if (allOccurrences && event.recurrence_rule_id) {
      await sql`
        UPDATE events SET status = 'CANCELLED', updated_at = NOW()
        WHERE recurrence_rule_id = ${event.recurrence_rule_id}
          AND calendar_id = ${event.calendar_id}
      `
    } else {
      await sql`
        UPDATE events SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = ${eventId}
      `
    }

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
