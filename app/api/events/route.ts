import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { notifyFamilyAboutEvent, type NotificationChannel } from "@/lib/notifications" // Event notifications
import { z } from "zod"
import { generateOccurrences, isValidTimeZone, recurrenceFromPreset, type RecurrenceInput } from "@/lib/recurrence"

const createEventSchema = z.object({
  calendarId: z.string().uuid("Invalid calendar ID").optional(),
  familyId: z.string().uuid("Invalid family ID").optional(),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional().nullable(),
  location: z.string().max(500).optional().nullable(),
  savedPlaceId: z.string().uuid().optional().nullable(),
  // Require an explicit UTC offset (e.g. a trailing "Z") so a zone-less
  // timestamp is rejected here rather than silently mis-stored by the
  // TIMESTAMPTZ column as if it were already UTC. See lib/datetime.ts,
  // which is what the calendar forms use to build a correctly-offset value.
  startTime: z.string().datetime({ offset: true, message: "startTime must include a UTC offset, e.g. end in 'Z'" }),
  endTime: z.string().datetime({ offset: true, message: "endTime must include a UTC offset, e.g. end in 'Z'" }),
  allDay: z.boolean().default(false),
  isAllDay: z.boolean().default(false),
  visibility: z.enum(["FAMILY", "PRIVATE", "SELECTED_MEMBERS"]).default("FAMILY"),
  category: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  reminderMinutes: z.array(z.number().int().min(0)).optional(),
  notifyChannels: z.array(z.enum(["in_app", "push", "email", "sms"])).optional(),
  participantIds: z.array(z.string().uuid()).optional(),
  participants: z.array(z.object({
    userId: z.string().uuid().optional().nullable(),
    childProfileId: z.string().uuid().optional().nullable(),
  })).optional(),
  recurrence: z.object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.number().int().min(1).default(1),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    monthOfYear: z.number().int().min(1).max(12).optional(),
    endDate: z.string().datetime().optional(),
    occurrenceCount: z.number().int().min(1).optional(),
  }).optional(),
  // Older clients (and cached app builds) send a preset string such as
  // "weekly" or "weekdays" plus isRecurring instead of a recurrence object.
  isRecurring: z.boolean().optional(),
  recurrenceRule: z.string().optional().nullable(),
  // IANA zone of the creator's device, so repeats keep the same wall-clock
  // time across daylight saving changes.
  timeZone: z.string().optional(),
})

// Get events
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const calendarId = searchParams.get("calendarId")
    const familyId = searchParams.get("familyId")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const status = searchParams.get("status")

    // SECURITY FIX: previously calendarId/familyId from the query string were
    // trusted directly, letting any authenticated user read another family's
    // events by passing its calendarId/familyId. Verify membership first.
    if (calendarId) {
      const access = await sql`
        SELECT 1 FROM calendars c
        JOIN family_members fm ON c.family_id = fm.family_id
        WHERE c.id = ${calendarId} AND fm.user_id = ${user.id} AND fm.is_active = true
      `
      if (access.length === 0) {
        return NextResponse.json(
          { success: false, error: "Calendar not found or access denied" },
          { status: 403 }
        )
      }
    }

    if (familyId) {
      const access = await sql`
        SELECT 1 FROM family_members
        WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
      `
      if (access.length === 0) {
        return NextResponse.json(
          { success: false, error: "Family not found or access denied" },
          { status: 403 }
        )
      }
    }

    // Build query based on filters
    let events
    if (calendarId) {
      events = await sql`
        SELECT 
          e.id, e.calendar_id, e.title, e.description, e.location,
          e.start_time, e.end_time, e.is_all_day, e.status, e.visibility,
          e.color, e.reminder_minutes, e.is_recurring, e.created_by_id,
          e.saved_place_id, e.recurrence_rule_id, e.created_at,
          c.name as calendar_name, c.color as calendar_color,
          u.first_name as creator_first_name, u.last_name as creator_last_name,
          sp.name as place_name, sp.address as place_address
        FROM events e
        JOIN calendars c ON e.calendar_id = c.id
        JOIN users u ON e.created_by_id = u.id
        LEFT JOIN saved_places sp ON e.saved_place_id = sp.id
        WHERE e.calendar_id = ${calendarId}
        AND e.status != 'CANCELLED'
        AND (${startDate}::timestamp IS NULL OR e.start_time >= ${startDate}::timestamp)
        AND (${endDate}::timestamp IS NULL OR e.end_time <= ${endDate}::timestamp)
        AND (${status}::text IS NULL OR e.status = ${status})
        ORDER BY e.start_time ASC
      `
    } else if (familyId) {
      // Get all events for a family
      // Build dynamic query based on provided filters
      if (status && startDate && endDate) {
        events = await sql`
          SELECT 
            e.id, e.calendar_id, e.title, e.description, e.location,
            e.start_time, e.end_time, e.is_all_day, e.status, e.visibility,
            e.color, e.reminder_minutes, e.is_recurring, e.created_by_id,
            e.saved_place_id, e.recurrence_rule_id, e.created_at,
            c.name as calendar_name, c.color as calendar_color,
            u.first_name as creator_first_name, u.last_name as creator_last_name,
            sp.name as place_name, sp.address as place_address
          FROM events e
          JOIN calendars c ON e.calendar_id = c.id
          JOIN users u ON e.created_by_id = u.id
          LEFT JOIN saved_places sp ON e.saved_place_id = sp.id
          WHERE c.family_id = ${familyId}
          AND e.status = ${status}
          AND e.start_time >= ${startDate}::timestamp
          AND e.start_time <= ${endDate}::timestamp
          ORDER BY e.start_time ASC
        `
      } else if (status) {
        events = await sql`
          SELECT 
            e.id, e.calendar_id, e.title, e.description, e.location,
            e.start_time, e.end_time, e.is_all_day, e.status, e.visibility,
            e.color, e.reminder_minutes, e.is_recurring, e.created_by_id,
            e.saved_place_id, e.recurrence_rule_id, e.created_at,
            c.name as calendar_name, c.color as calendar_color,
            u.first_name as creator_first_name, u.last_name as creator_last_name,
            sp.name as place_name, sp.address as place_address
          FROM events e
          JOIN calendars c ON e.calendar_id = c.id
          JOIN users u ON e.created_by_id = u.id
          LEFT JOIN saved_places sp ON e.saved_place_id = sp.id
          WHERE c.family_id = ${familyId}
          AND e.status = ${status}
          ORDER BY e.start_time ASC
        `
      } else if (startDate && endDate) {
        events = await sql`
          SELECT 
            e.id, e.calendar_id, e.title, e.description, e.location,
            e.start_time, e.end_time, e.is_all_day, e.status, e.visibility,
            e.color, e.reminder_minutes, e.is_recurring, e.created_by_id,
            e.saved_place_id, e.recurrence_rule_id, e.created_at,
            c.name as calendar_name, c.color as calendar_color,
            u.first_name as creator_first_name, u.last_name as creator_last_name,
            sp.name as place_name, sp.address as place_address
          FROM events e
          JOIN calendars c ON e.calendar_id = c.id
          JOIN users u ON e.created_by_id = u.id
          LEFT JOIN saved_places sp ON e.saved_place_id = sp.id
          WHERE c.family_id = ${familyId}
          AND e.status != 'CANCELLED'
          AND e.start_time >= ${startDate}::timestamp
          AND e.start_time <= ${endDate}::timestamp
          ORDER BY e.start_time ASC
        `
      } else {
        events = await sql`
          SELECT 
            e.id, e.calendar_id, e.title, e.description, e.location,
            e.start_time, e.end_time, e.is_all_day, e.status, e.visibility,
            e.color, e.reminder_minutes, e.is_recurring, e.created_by_id,
            e.saved_place_id, e.recurrence_rule_id, e.created_at,
            c.name as calendar_name, c.color as calendar_color,
            u.first_name as creator_first_name, u.last_name as creator_last_name,
            sp.name as place_name, sp.address as place_address
          FROM events e
          JOIN calendars c ON e.calendar_id = c.id
          JOIN users u ON e.created_by_id = u.id
          LEFT JOIN saved_places sp ON e.saved_place_id = sp.id
          WHERE c.family_id = ${familyId}
          AND e.status != 'CANCELLED'
          ORDER BY e.start_time ASC
        `
      }
    } else {
      // Get all events user can see
      events = await sql`
        SELECT 
          e.id, e.calendar_id, e.title, e.description, e.location,
          e.start_time, e.end_time, e.is_all_day, e.status, e.visibility,
          e.color, e.reminder_minutes, e.is_recurring, e.created_by_id,
          e.saved_place_id, e.recurrence_rule_id, e.created_at,
          c.name as calendar_name, c.color as calendar_color, c.family_id,
          u.first_name as creator_first_name, u.last_name as creator_last_name,
          sp.name as place_name, sp.address as place_address
        FROM events e
        JOIN calendars c ON e.calendar_id = c.id
        JOIN users u ON e.created_by_id = u.id
        JOIN family_members fm ON c.family_id = fm.family_id AND fm.user_id = ${user.id}
        LEFT JOIN saved_places sp ON e.saved_place_id = sp.id
        WHERE fm.is_active = true
        AND e.status != 'CANCELLED'
        AND (e.visibility = 'FAMILY' OR e.created_by_id = ${user.id})
        AND (${startDate}::timestamp IS NULL OR e.start_time >= ${startDate}::timestamp)
        AND (${endDate}::timestamp IS NULL OR e.end_time <= ${endDate}::timestamp)
        AND (${status}::text IS NULL OR e.status = ${status})
        ORDER BY e.start_time ASC
        LIMIT 500
      `
    }
    
    // Apply history limit based on subscription (for past events)
    // FREE: 30 days, PREMIUM (Basic): 90 days, PREMIUM_PLUS (Premium): 365 days
    const effectiveFamilyId = familyId || (events[0]?.family_id ? events[0].family_id : null)
    let historyDays = 30 // Default for free tier
    
    if (effectiveFamilyId) {
      try {
        const subscription = await checkFamilySubscription(effectiveFamilyId)
        historyDays = subscription.features.historyDays || 30
      } catch {
        // Default to 30 days if subscription check fails
        historyDays = 30
      }
    }
    
    const historyLimitDate = new Date()
    historyLimitDate.setDate(historyLimitDate.getDate() - historyDays)
    
    // Filter events: keep all future events, limit past events to subscription history
    const filteredEvents = events.filter(e => {
      const eventDate = new Date(e.start_time)
      // Keep event if it's in the future or within the history limit
      return eventDate >= historyLimitDate
    })

    // Get participants for all events
    const eventIds = filteredEvents.map(e => e.id)
    let participants: Array<{ event_id: string; user_id: string; status: string; first_name: string; last_name: string }> = []
    
    if (eventIds.length > 0) {
      participants = await sql`
        SELECT 
          ep.event_id, ep.user_id, ep.status,
          u.first_name, u.last_name
        FROM event_participants ep
        JOIN users u ON ep.user_id = u.id
        WHERE ep.event_id = ANY(${eventIds})
      `
    }

    // Group participants by event
    const participantsByEvent = participants.reduce((acc, p) => {
      if (!acc[p.event_id]) acc[p.event_id] = []
      acc[p.event_id].push({
        userId: p.user_id,
        status: p.status,
        name: `${p.first_name} ${p.last_name}`,
      })
      return acc
    }, {} as Record<string, Array<{ userId: string; status: string; name: string }>>)

    return NextResponse.json({
      success: true,
      historyDays, // Include for client reference
      events: filteredEvents.map((e) => ({
        id: e.id,
        calendarId: e.calendar_id,
        title: e.title,
        description: e.description,
        location: e.location,
        startTime: e.start_time,
        endTime: e.end_time,
        isAllDay: e.is_all_day,
        status: e.status,
        visibility: e.visibility,
        color: e.color || e.calendar_color,
        reminderMinutes: e.reminder_minutes,
        isRecurring: e.is_recurring,
        createdById: e.created_by_id,
        creatorName: `${e.creator_first_name} ${e.creator_last_name}`,
        calendar: {
          name: e.calendar_name,
          color: e.calendar_color,
        },
        savedPlace: e.saved_place_id ? {
          id: e.saved_place_id,
          name: e.place_name,
          address: e.place_address,
        } : null,
        participants: participantsByEvent[e.id] || [],
        createdAt: e.created_at,
      })),
    })
  } catch (error) {
    console.error("Get events error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get events" },
      { status: 500 }
    )
  }
}

// Create event
export async function POST(request: NextRequest) {
  try {
  const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = createEventSchema.parse(body)
    
    // Handle isAllDay or allDay field
    const isAllDay = validatedData.isAllDay || validatedData.allDay || false

    let calendar
    
    if (validatedData.calendarId) {
      // Get calendar by ID and verify access
      const calendars = await sql`
        SELECT c.id, c.family_id, fm.role, fm.can_create_events, fm.requires_event_approval
        FROM calendars c
        JOIN family_members fm ON c.family_id = fm.family_id
        WHERE c.id = ${validatedData.calendarId} 
        AND fm.user_id = ${user.id} 
        AND fm.is_active = true
      `

      if (calendars.length === 0) {
        return NextResponse.json(
          { success: false, error: "Calendar not found or access denied" },
          { status: 404 }
        )
      }
      calendar = calendars[0]
    } else if (validatedData.familyId) {
      // Get default calendar for the family or create one
      const calendars = await sql`
        SELECT c.id, c.family_id, fm.role, fm.can_create_events, fm.requires_event_approval
        FROM calendars c
        JOIN family_members fm ON c.family_id = fm.family_id
        WHERE c.family_id = ${validatedData.familyId}
        AND c.is_default = true
        AND fm.user_id = ${user.id} 
        AND fm.is_active = true
      `

      if (calendars.length === 0) {
        // Try to get any calendar for this family
        const anyCalendars = await sql`
          SELECT c.id, c.family_id, fm.role, fm.can_create_events, fm.requires_event_approval
          FROM calendars c
          JOIN family_members fm ON c.family_id = fm.family_id
          WHERE c.family_id = ${validatedData.familyId}
          AND fm.user_id = ${user.id} 
          AND fm.is_active = true
          LIMIT 1
        `
        
        if (anyCalendars.length === 0) {
          // Create a default calendar for this family
          const calendarId = crypto.randomUUID()
          await sql`
            INSERT INTO calendars (id, family_id, name, is_default, color, created_at, updated_at)
            VALUES (${calendarId}, ${validatedData.familyId}, 'Family Calendar', true, '#3B82F6', NOW(), NOW())
          `
          
          // Fetch the new calendar with member info
          const newCalendars = await sql`
            SELECT c.id, c.family_id, fm.role, fm.can_create_events, fm.requires_event_approval
            FROM calendars c
            JOIN family_members fm ON c.family_id = fm.family_id
            WHERE c.id = ${calendarId}
            AND fm.user_id = ${user.id} 
            AND fm.is_active = true
          `
          calendar = newCalendars[0]
        } else {
          calendar = anyCalendars[0]
        }
      } else {
        calendar = calendars[0]
      }
    } else {
      return NextResponse.json(
        { success: false, error: "Either calendarId or familyId is required" },
        { status: 400 }
      )
    }

    if (!calendar) {
      return NextResponse.json(
        { success: false, error: "Could not find or create calendar" },
        { status: 404 }
      )
    }

    // Check if user can create events
    if (!calendar.can_create_events && calendar.role !== "PARENT") {
      return NextResponse.json(
        { success: false, error: "You don't have permission to create events" },
        { status: 403 }
      )
    }

    // Who is actually invited. The event form sends `participants`
    // ({ userId } for adult members, { childProfileId } for children), but
    // this route only ever looked at `participantIds`, so anyone picked on
    // the form was silently dropped - no participant rows, no conflict check
    // for them, nothing in their member activity. Merge both shapes, map a
    // child to their linked user account when they have one (a child profile
    // with no login has no user_id to store), and keep only people who are
    // active members of THIS family.
    const requestedUserIds = new Set<string>(validatedData.participantIds || [])
    const requestedChildIds: string[] = []
    for (const p of validatedData.participants || []) {
      if (p.userId) requestedUserIds.add(p.userId)
      if (p.childProfileId) requestedChildIds.push(p.childProfileId)
    }
    if (requestedChildIds.length > 0) {
      const childUsers = await sql`
        SELECT fm.user_id
        FROM child_profiles cp
        JOIN family_members fm ON cp.family_member_id = fm.id
        WHERE cp.id = ANY(${requestedChildIds}::text[])
        AND fm.family_id = ${calendar.family_id}
        AND fm.user_id IS NOT NULL
      `
      for (const row of childUsers) requestedUserIds.add(row.user_id)
    }
    let participantUserIds: string[] = []
    if (requestedUserIds.size > 0) {
      const validMembers = await sql`
        SELECT DISTINCT user_id FROM family_members
        WHERE family_id = ${calendar.family_id}
        AND is_active = true
        AND user_id = ANY(${Array.from(requestedUserIds)}::text[])
      `
      participantUserIds = validMembers.map((m) => m.user_id as string)
    }

    // Work out the recurrence (if any) and every occurrence's start/end up
    // front. The first occurrence becomes the "main" event row below; the
    // rest are copied from it after it is inserted. (The form used to send
    // isRecurring/recurrenceRule, which this route silently dropped, so
    // "recurring" events were only ever created once.)
    let recurrenceInput: RecurrenceInput | null = validatedData.recurrence
      ? {
          frequency: validatedData.recurrence.frequency,
          interval: validatedData.recurrence.interval,
          daysOfWeek: validatedData.recurrence.daysOfWeek,
          endDate: validatedData.recurrence.endDate,
          occurrenceCount: validatedData.recurrence.occurrenceCount,
        }
      : validatedData.isRecurring && validatedData.recurrenceRule
        ? recurrenceFromPreset(validatedData.recurrenceRule)
        : null

    const eventTimeZone = isValidTimeZone(validatedData.timeZone)
      ? validatedData.timeZone
      : isValidTimeZone(user.timezone)
        ? user.timezone
        : "UTC"

    let occurrenceStarts: string[] = [validatedData.startTime]
    let occurrenceEnds: string[] = [validatedData.endTime]
    let occurrencesTruncated = false
    if (recurrenceInput) {
      const generated = generateOccurrences(
        validatedData.startTime,
        validatedData.endTime,
        recurrenceInput,
        eventTimeZone
      )
      occurrenceStarts = generated.starts
      occurrenceEnds = generated.ends
      occurrencesTruncated = generated.truncated
    }
    const mainStart = occurrenceStarts[0]
    const mainEnd = occurrenceEnds[0]

    // Check for conflicts
    const conflicts = await checkEventConflicts(
      mainStart,
      mainEnd,
      participantUserIds.length > 0 ? participantUserIds : [user.id],
      null
    )

    if (conflicts.length > 0 && calendar.role !== "PARENT") {
      return NextResponse.json(
        { 
          success: false, 
          error: "Event conflicts with existing events",
          conflicts 
        },
        { status: 409 }
      )
    }

    // Determine initial status
    const status = calendar.requires_event_approval ? "PENDING" : "APPROVED"

    // Create recurrence rule if recurring
    let recurrenceRuleId = null
    if (recurrenceInput) {
      recurrenceRuleId = crypto.randomUUID()
      await sql`
        INSERT INTO recurrence_rules (
          id, frequency, interval, days_of_week, day_of_month, 
          month_of_year, end_date, occurrence_count, created_at, updated_at
        )
        VALUES (
          ${recurrenceRuleId},
          ${recurrenceInput.frequency},
          ${recurrenceInput.interval},
          ${recurrenceInput.daysOfWeek || null},
          ${validatedData.recurrence?.dayOfMonth || null},
          ${validatedData.recurrence?.monthOfYear || null},
          ${recurrenceInput.endDate || null},
          ${recurrenceInput.occurrenceCount || null},
          NOW(), NOW()
        )
      `
    }

    // Create event
    const eventId = crypto.randomUUID()
    await sql`
      INSERT INTO events (
        id, calendar_id, created_by_id, title, description, location,
        saved_place_id, start_time, end_time, is_all_day, status, visibility,
        color, reminder_minutes, notify_channels, is_recurring, recurrence_rule_id,
        created_at, updated_at
      )
  VALUES (
  ${eventId},
  ${calendar.id},
  ${user.id},
  ${validatedData.title},
  ${validatedData.description || null},
  ${validatedData.location || null},
  ${validatedData.savedPlaceId || null},
  ${mainStart},
  ${mainEnd},
  ${isAllDay},
  ${status},
        ${validatedData.visibility},
        ${validatedData.color || null},
        ${validatedData.reminderMinutes || [15]},
        ${validatedData.notifyChannels && validatedData.notifyChannels.length > 0 ? validatedData.notifyChannels : null},
        ${!!recurrenceInput},
        ${recurrenceRuleId},
        NOW(), NOW()
      )
    `

    // Add participants
    if (participantUserIds.length > 0) {
      await sql`
        INSERT INTO event_participants (id, event_id, user_id, status, created_at, updated_at)
        SELECT gen_random_uuid(), ${eventId}, pid, 'PENDING', NOW(), NOW()
        FROM unnest(${participantUserIds}::text[]) AS pid
      `
    }

    // Create event request if pending approval
    if (status === "PENDING") {
      await sql`
        INSERT INTO event_requests (
          id, event_id, requestor_id, status, requested_at
        )
        VALUES (
          ${crypto.randomUUID()}, ${eventId}, ${user.id}, 'PENDING', NOW()
        )
      `
    }

    // Copy the remaining occurrences from the main event row. One bulk
    // statement per table (not one INSERT per occurrence) so a year of daily
    // repeats doesn't turn into hundreds of round trips.
    let occurrencesCreated = 1
    if (recurrenceRuleId && occurrenceStarts.length > 1) {
      const restStarts = occurrenceStarts.slice(1)
      const restEnds = occurrenceEnds.slice(1)

      await sql`
        INSERT INTO events (
          id, calendar_id, created_by_id, title, description, location,
          saved_place_id, start_time, end_time, is_all_day, status, visibility,
          color, reminder_minutes, notify_channels, is_recurring, recurrence_rule_id,
          created_at, updated_at
        )
        SELECT
          gen_random_uuid(), e0.calendar_id, e0.created_by_id, e0.title, e0.description, e0.location,
          e0.saved_place_id, t.s, t.e, e0.is_all_day, e0.status, e0.visibility,
          e0.color, e0.reminder_minutes, e0.notify_channels, e0.is_recurring, e0.recurrence_rule_id,
          NOW(), NOW()
        FROM events e0
        CROSS JOIN unnest(${restStarts}::timestamptz[], ${restEnds}::timestamptz[]) AS t(s, e)
        WHERE e0.id = ${eventId}
      `

      await sql`
        INSERT INTO event_participants (id, event_id, user_id, status, created_at, updated_at)
        SELECT gen_random_uuid(), ne.id, ep.user_id, 'PENDING', NOW(), NOW()
        FROM events ne
        JOIN event_participants ep ON ep.event_id = ${eventId}
        WHERE ne.recurrence_rule_id = ${recurrenceRuleId} AND ne.id <> ${eventId}
      `

      if (status === "PENDING") {
        await sql`
          INSERT INTO event_requests (id, event_id, requestor_id, status, requested_at)
          SELECT gen_random_uuid(), ne.id, ${user.id}::uuid, 'PENDING', NOW()
          FROM events ne
          WHERE ne.recurrence_rule_id = ${recurrenceRuleId} AND ne.id <> ${eventId}
        `
      }

      occurrencesCreated = occurrenceStarts.length
    }

    // Audit log
    await logAuditEvent(user.id, "CREATE", "event", eventId, {
      newValue: { title: validatedData.title, calendarId: validatedData.calendarId, status },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    // Notify family members about the new event
    const creatorName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'A family member'
    await notifyFamilyAboutEvent(
      calendar.family_id,
      validatedData.title,
      eventId,
      creatorName,
      user.id, // Exclude the creator from notifications
      validatedData.notifyChannels && validatedData.notifyChannels.length > 0
        ? (validatedData.notifyChannels as NotificationChannel[])
        : undefined
    )

    return NextResponse.json({
      success: true,
      data: {
        id: eventId,
        status,
        requiresApproval: status === "PENDING",
        occurrencesCreated,
        occurrencesTruncated,
      },
      message: status === "PENDING" 
        ? "Event created and pending approval" 
        : "Event created successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Create event error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create event" },
      { status: 500 }
    )
  }
}

async function checkEventConflicts(
  startTime: string,
  endTime: string,
  participantIds: string[],
  excludeEventId: string | null
): Promise<Array<{ eventId: string; title: string; participantId: string }>> {
  if (participantIds.length === 0) return []

  let conflicts
  if (excludeEventId) {
    conflicts = await sql`
      SELECT DISTINCT e.id, e.title, ep.user_id as participant_id
      FROM events e
      JOIN event_participants ep ON e.id = ep.event_id
      WHERE ep.user_id::text = ANY(${participantIds}::text[])
      AND e.status = 'APPROVED'
      AND e.start_time < ${endTime}::timestamp
      AND e.end_time > ${startTime}::timestamp
      AND e.id != ${excludeEventId}
    `
  } else {
    conflicts = await sql`
      SELECT DISTINCT e.id, e.title, ep.user_id as participant_id
      FROM events e
      JOIN event_participants ep ON e.id = ep.event_id
      WHERE ep.user_id::text = ANY(${participantIds}::text[])
      AND e.status = 'APPROVED'
      AND e.start_time < ${endTime}::timestamp
      AND e.end_time > ${startTime}::timestamp
    `
  }

  return conflicts.map(c => ({
    eventId: c.id,
    title: c.title,
    participantId: c.participant_id,
  }))
}
