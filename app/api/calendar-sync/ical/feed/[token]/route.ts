import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

// Public, unauthenticated ICS feed. Security comes from the `token` being an
// unguessable random value (calendar_sync_connections.ical_token) rather than
// a login, because calendar apps (Apple Calendar, Outlook, Google Calendar's
// "From URL" import, etc.) fetch subscription URLs anonymously - they can't
// send an Authorization header. This is what lets Togethr integrate with any
// calendar app, not just Google, without needing an OAuth integration for
// each one.

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function toICSDate(date: Date, allDay: boolean): string {
  if (allDay) {
    return date.toISOString().slice(0, 10).replace(/-/g, '')
  }
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function foldLine(line: string): string {
  // RFC 5545 requires long lines to be folded at 75 octets, continued with
  // a leading space.
  if (line.length <= 75) return line
  const chunks: string[] = []
  let rest = line
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75))
    rest = ' ' + rest.slice(75)
  }
  chunks.push(rest)
  return chunks.join('\r\n')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!token) {
    return new NextResponse('Not found', { status: 404 })
  }

  const connections = await sql`
    SELECT id, family_id, user_id, sync_enabled
    FROM calendar_sync_connections
    WHERE ical_token = ${token}
  `

  if (connections.length === 0 || !connections[0].sync_enabled) {
    return new NextResponse('Feed not found or disabled', { status: 404 })
  }

  const familyId = connections[0].family_id
  const feedUserId = connections[0].user_id

  // Export a rolling window: 3 months back, 12 months ahead, so the feed
  // doesn't grow unbounded but still covers most calendar apps' default view.
  const events = await sql`
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

  // Personal reminders (standalone, not tied to a task or event) for
  // whichever user generated this feed link - exported as VTODO alongside
  // the VEVENTs above. Same rolling window as events. Most calendar apps
  // (including, as far as we can tell, Samsung's own Calendar/Reminders)
  // render VEVENTs reliably but handle subscribed VTODOs inconsistently or
  // not at all - these are included on a best-effort basis, and the UI
  // that surfaces this feed says so rather than promising reminders will
  // show up.
  const reminders = feedUserId
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
    lines.push(`DTSTAMP:${toICSDate(new Date(), false)}`)
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

  for (const reminder of reminders) {
    const due = new Date(reminder.remind_at)

    lines.push('BEGIN:VTODO')
    lines.push(foldLine(`UID:reminder-${reminder.id}@togethrapp.com`))
    lines.push(`DTSTAMP:${toICSDate(new Date(), false)}`)
    lines.push(`DUE:${toICSDate(due, false)}`)
    lines.push(foldLine(`SUMMARY:${escapeICSText(reminder.title)}`))
    if (reminder.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeICSText(reminder.description)}`))
    }
    lines.push('STATUS:NEEDS-ACTION')
    lines.push(`LAST-MODIFIED:${toICSDate(new Date(reminder.updated_at || reminder.created_at), false)}`)
    lines.push('END:VTODO')
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
