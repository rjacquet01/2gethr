import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { ensureSyncSchema } from '@/lib/sync-schema'
import { checkFamilySubscription } from '@/lib/auth'
import { getTierDefinition } from '@/lib/subscription-tiers'

// Public, unauthenticated ICS feed. Security comes from the `token` being an
// unguessable random value (calendar_sync_connections.ical_token) rather than
// a login, because calendar apps (Apple Calendar, Outlook, Google Calendar's
// "From URL" import, etc.) fetch subscription URLs anonymously - they can't
// send an Authorization header. This is what lets Togethr integrate with any
// calendar app, not just Google, without needing an OAuth integration for
// each one.
//
// The feed carries three kinds of items:
//   - family calendar events (VEVENT)
//   - family tasks that have a due date
//   - the feed owner's personal reminders
// Tasks and reminders are published as calendar items (VEVENT with an
// alert) by default, because that is the only form that Apple Calendar,
// Outlook and Google Calendar on Android all actually display from a
// subscribed link - they ignore subscribed VTODOs. Apps that do understand
// to-do items (Thunderbird, Outlook desktop import, etc.) can use
// `?format=vtodo`. `?include=events,tasks,reminders` picks which kinds to
// send (default: everything the user turned on in Settings > Calendar Sync).

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function toICSDate(date: Date, allDay: boolean): string {
  if (allDay) {
    return date.toISOString().slice(0, 10).replace(/-/g, '')
  }
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

// RFC 5545: fold at 75 OCTETS (not characters - emoji and accents are
// multi-byte), continuation lines start with a single space.
function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line
  const out: string[] = []
  let current = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8')
    if (bytes + b > limit) {
      out.push(current)
      current = ' '
      bytes = 1
      limit = 75
    }
    current += ch
    bytes += b
  }
  out.push(current)
  return out.join('\r\n')
}

function localParts(date: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  return {
    ymd: `${get('year')}${get('month')}${get('day')}` as string,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  }
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days))
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function alarm(trigger: string, description: string): string[] {
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    foldLine(`DESCRIPTION:${escapeICSText(description)}`),
    `TRIGGER:${trigger}`,
    'END:VALARM',
  ]
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!token) {
    return new NextResponse('Not found', { status: 404 })
  }

  await ensureSyncSchema()

  const connections = await sql`
    SELECT id, family_id, user_id, sync_enabled, feed_include_tasks, feed_include_reminders
    FROM calendar_sync_connections
    WHERE ical_token = ${token}
  `

  if (connections.length === 0 || !connections[0].sync_enabled) {
    return new NextResponse('Feed not found or disabled', { status: 404 })
  }

  const familyId = connections[0].family_id
  const feedUserId = connections[0].user_id

  // Calendar export is a Basic/Premium feature: a family that dropped back to
  // Free stops serving the feed.
  const feedSub = await checkFamilySubscription(familyId)
  if (!getTierDefinition(feedSub.tier).features.exportCalendar) {
    return new NextResponse('Calendar export requires a Basic or Premium plan', { status: 403 })
  }

  const url = new URL(request.url)
  const includeParam = url.searchParams.get('include')
  const asTodo = url.searchParams.get('format') === 'vtodo'
  const include = new Set(
    includeParam
      ? includeParam.split(',').map((s) => s.trim().toLowerCase())
      : [
          'events',
          ...(connections[0].feed_include_tasks !== false ? ['tasks'] : []),
          ...(connections[0].feed_include_reminders !== false ? ['reminders'] : []),
        ]
  )

  let timeZone = 'UTC'
  if (feedUserId && (include.has('tasks') || include.has('reminders'))) {
    const u = await sql`SELECT timezone FROM users WHERE id = ${feedUserId}`
    if (u[0]?.timezone) timeZone = u[0].timezone
  }

  // Export a rolling window: 3 months back, 12 months ahead, so the feed
  // doesn't grow unbounded but still covers most calendar apps' default view.
  const events = include.has('events')
    ? await sql`
        SELECT e.id, e.title, e.description, e.location,
               e.start_time, e.end_time, e.is_all_day, e.updated_at, e.created_at
        FROM events e
        JOIN calendars c ON e.calendar_id = c.id
        WHERE c.family_id = ${familyId}
        AND e.status != 'CANCELLED'
        AND e.start_time >= NOW() - INTERVAL '3 months'
        AND e.start_time <= NOW() + INTERVAL '12 months'
        ORDER BY e.start_time ASC
      `
    : []

  // Family tasks that have a due date (a task with no date has nowhere to go
  // on a calendar). Completed tasks stay for two weeks so a finished task
  // doesn't vanish and re-appear as a duplicate in apps that cache.
  const tasks = include.has('tasks')
    ? await sql`
        SELECT t.id, t.title, t.description, t.due_date, t.status, t.priority,
               t.updated_at, t.created_at,
               u.first_name AS assignee_first_name, cp.display_name AS child_display_name
        FROM tasks t
        LEFT JOIN users u ON t.assigned_to_id = u.id
        LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
        WHERE t.family_id = ${familyId}
          AND t.due_date IS NOT NULL
          AND t.status NOT IN ('ARCHIVED', 'CANCELLED')
          AND t.due_date >= NOW() - INTERVAL '3 months'
          AND t.due_date <= NOW() + INTERVAL '12 months'
          AND (t.status != 'COMPLETED' OR t.due_date >= NOW() - INTERVAL '14 days')
        ORDER BY t.due_date ASC
      `
    : []

  // Personal reminders (standalone, not tied to a task or event) for
  // whichever user generated this feed link.
  const reminders = include.has('reminders') && feedUserId
    ? await sql`
        SELECT id, title, description, remind_at, status, updated_at, created_at
        FROM reminders
        WHERE user_id = ${feedUserId}
          AND status = 'PENDING'
          AND remind_at >= NOW() - INTERVAL '3 months'
          AND remind_at <= NOW() + INTERVAL '12 months'
        ORDER BY remind_at ASC
      `
    : []

  const stamp = toICSDate(new Date(), false)
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//Togethr//Family Calendar//EN')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push('X-WR-CALNAME:Togethr')
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT15M')
  lines.push('X-PUBLISHED-TTL:PT15M')

  for (const event of events) {
    const isAllDay = !!event.is_all_day
    const start = new Date(event.start_time)
    const end = new Date(event.end_time)

    lines.push('BEGIN:VEVENT')
    lines.push(foldLine(`UID:${event.id}@togethrapp.com`))
    lines.push(`DTSTAMP:${stamp}`)
    if (isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${toICSDate(start, true)}`)
      lines.push(`DTEND;VALUE=DATE:${toICSDate(end, true)}`)
    } else {
      lines.push(`DTSTART:${toICSDate(start, false)}`)
      lines.push(`DTEND:${toICSDate(end, false)}`)
    }
    lines.push(foldLine(`SUMMARY:${escapeICSText(event.title)}`))
    if (event.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeICSText(event.description)}`))
    }
    if (event.location) {
      lines.push(foldLine(`LOCATION:${escapeICSText(event.location)}`))
    }
    lines.push(`LAST-MODIFIED:${toICSDate(new Date(event.updated_at || event.created_at), false)}`)
    lines.push('END:VEVENT')
  }

  for (const task of tasks) {
    const due = new Date(task.due_date)
    const done = task.status === 'COMPLETED'
    const who = task.child_display_name || task.assignee_first_name || ''
    const title = `${done ? '✓' : '☐'} ${task.title}${who ? ` (${who})` : ''}`
    const descParts = [
      who ? `Assigned to: ${who}` : '',
      task.priority ? `Priority: ${String(task.priority).toLowerCase()}` : '',
      task.description || '',
    ].filter(Boolean)
    const lastMod = toICSDate(new Date(task.updated_at || task.created_at), false)

    if (asTodo) {
      lines.push('BEGIN:VTODO')
      lines.push(foldLine(`UID:task-${task.id}@togethrapp.com`))
      lines.push(`DTSTAMP:${stamp}`)
      lines.push(`DUE:${toICSDate(due, false)}`)
      lines.push(foldLine(`SUMMARY:${escapeICSText(task.title)}`))
      if (descParts.length) lines.push(foldLine(`DESCRIPTION:${escapeICSText(descParts.join('\n'))}`))
      lines.push(`STATUS:${done ? 'COMPLETED' : 'NEEDS-ACTION'}`)
      lines.push(`LAST-MODIFIED:${lastMod}`)
      if (!done) lines.push(...alarm('-PT30M', task.title))
      lines.push('END:VTODO')
      continue
    }

    // The create form defaults a date-only task to 23:59:59 local time; show
    // those as all-day items rather than a late-night appointment.
    // A due value of exactly 00:00:00 UTC is a date-only task (the date
    // pickers on other entry paths, and imports, store midnight UTC) - show it
    // on that calendar date instead of shifting it into the previous evening.
    const local = localParts(due, timeZone)
    const midnightUtc =
      due.getUTCHours() === 0 && due.getUTCMinutes() === 0 && due.getUTCSeconds() === 0
    const allDay = midnightUtc || (local.hour === 23 && local.minute >= 58)
    if (midnightUtc) local.ymd = due.toISOString().slice(0, 10).replace(/-/g, '')

    lines.push('BEGIN:VEVENT')
    lines.push(foldLine(`UID:task-${task.id}@togethrapp.com`))
    lines.push(`DTSTAMP:${stamp}`)
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${local.ymd}`)
      lines.push(`DTEND;VALUE=DATE:${addDaysYmd(local.ymd, 1)}`)
    } else {
      lines.push(`DTSTART:${toICSDate(due, false)}`)
      lines.push(`DTEND:${toICSDate(new Date(due.getTime() + 30 * 60 * 1000), false)}`)
    }
    lines.push(foldLine(`SUMMARY:${escapeICSText(title)}`))
    if (descParts.length) lines.push(foldLine(`DESCRIPTION:${escapeICSText(descParts.join('\n'))}`))
    lines.push('CATEGORIES:Task')
    lines.push('TRANSP:TRANSPARENT')
    lines.push(`LAST-MODIFIED:${lastMod}`)
    if (!done) lines.push(...alarm(allDay ? 'PT9H' : '-PT30M', task.title))
    lines.push('END:VEVENT')
  }

  for (const reminder of reminders) {
    const at = new Date(reminder.remind_at)
    const lastMod = toICSDate(new Date(reminder.updated_at || reminder.created_at), false)

    if (asTodo) {
      lines.push('BEGIN:VTODO')
      lines.push(foldLine(`UID:reminder-${reminder.id}@togethrapp.com`))
      lines.push(`DTSTAMP:${stamp}`)
      lines.push(`DUE:${toICSDate(at, false)}`)
      lines.push(foldLine(`SUMMARY:${escapeICSText(reminder.title)}`))
      if (reminder.description) lines.push(foldLine(`DESCRIPTION:${escapeICSText(reminder.description)}`))
      lines.push('STATUS:NEEDS-ACTION')
      lines.push(`LAST-MODIFIED:${lastMod}`)
      lines.push(...alarm('PT0S', reminder.title))
      lines.push('END:VTODO')
      continue
    }

    lines.push('BEGIN:VEVENT')
    lines.push(foldLine(`UID:reminder-${reminder.id}@togethrapp.com`))
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART:${toICSDate(at, false)}`)
    lines.push(`DTEND:${toICSDate(new Date(at.getTime() + 15 * 60 * 1000), false)}`)
    lines.push(foldLine(`SUMMARY:${escapeICSText(`⏰ ${reminder.title}`)}`))
    if (reminder.description) lines.push(foldLine(`DESCRIPTION:${escapeICSText(reminder.description)}`))
    lines.push('CATEGORIES:Reminder')
    lines.push('TRANSP:TRANSPARENT')
    lines.push(`LAST-MODIFIED:${lastMod}`)
    lines.push(...alarm('PT0S', reminder.title))
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  const body = lines.join('\r\n') + '\r\n'

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="togethr.ics"',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
