import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { splitIcsComponents, parseIcsField, parseIcsDateValue } from '@/lib/services/caldav'

// POST - One-off import of a .ics file (uploaded) or a remote .ics/webcal
// URL, into the caller's family. This is the generic "import from any
// standard calendar app" path: Outlook, Android, iOS, and anything else
// that can export or publish an iCalendar feed, but that we don't have a
// dedicated OAuth/CalDAV connector for. Unlike the Google/Apple sync
// routes, this has no ongoing "connection" - it's a single pull, run once
// per uploaded file or URL the user provides.
//
// Accepts either:
//   - multipart/form-data with a "file" field (the .ics file contents), or
//   - application/json with a "url" field (a public .ics/webcal link)
//
// Imports both VEVENT (-> events) and VTODO (-> tasks) components found in
// the file. Dedupes against what's already in the family's data by
// title+start/due time, via the ics_import_records claim-ticket table (see
// scripts/add-ics-import-dedup-table.sql) - so re-importing the same file
// twice, or double-clicking "Import" once, is a no-op rather than a race.
const MAX_ICS_BYTES = 5 * 1024 * 1024 // 5MB - generous for a calendar export, not for abuse
const MAX_ITEMS_PER_TYPE = 1000 // guard against pathological files / serverless timeouts

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || 'Not authenticated' }, { status: 401 })
    }

    const familyMembership = await sql`
      SELECT family_id FROM family_members
      WHERE user_id = ${user.id} AND is_active = true
      LIMIT 1
    `
    if (familyMembership.length === 0) {
      return NextResponse.json({ success: false, error: 'No family found' }, { status: 404 })
    }
    const familyId = familyMembership[0].family_id

    let icsText: string
    let sourceLabel: string

    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      if (!file || typeof file === 'string') {
        return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
      }
      if (file.size > MAX_ICS_BYTES) {
        return NextResponse.json({ success: false, error: 'File is too large (5MB limit)' }, { status: 400 })
      }
      icsText = await file.text()
      sourceLabel = file.name || 'uploaded file'
    } else {
      const body = await request.json().catch(() => ({}))
      const url: string | undefined = body.url
      if (!url) {
        return NextResponse.json({ success: false, error: 'No file or url provided' }, { status: 400 })
      }
      // webcal:// is just https:// in disguise - calendar apps use it to
      // signal "open with my calendar app", but it's the same feed over
      // HTTPS when fetched server-side.
      const normalizedUrl = url.replace(/^webcal:\/\//i, 'https://')
      let parsed: URL
      try {
        parsed = new URL(normalizedUrl)
      } catch {
        return NextResponse.json({ success: false, error: 'Invalid URL' }, { status: 400 })
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return NextResponse.json({ success: false, error: 'URL must be http(s) or webcal' }, { status: 400 })
      }

      const res = await fetch(parsed.toString(), {
        headers: { Accept: 'text/calendar, text/plain, */*' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        return NextResponse.json({ success: false, error: `Could not fetch calendar (HTTP ${res.status})` }, { status: 400 })
      }
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_ICS_BYTES) {
        return NextResponse.json({ success: false, error: 'Calendar feed is too large (5MB limit)' }, { status: 400 })
      }
      icsText = new TextDecoder('utf-8').decode(buf)
      sourceLabel = parsed.hostname
    }

    if (!/BEGIN:VCALENDAR/i.test(icsText)) {
      return NextResponse.json({ success: false, error: 'That doesn\'t look like a valid .ics calendar file' }, { status: 400 })
    }

    // --- Events (VEVENT -> events table) ---
    const eventBlocks = splitIcsComponents(icsText, 'VEVENT').slice(0, MAX_ITEMS_PER_TYPE)
    let eventsImported = 0
    let eventsSkipped = 0

    if (eventBlocks.length > 0) {
      const calendars = await sql`
        SELECT id FROM calendars WHERE family_id = ${familyId} AND name = 'Imported Events' LIMIT 1
      `
      let calendarId: string
      if (calendars.length === 0) {
        const newCalendar = await sql`
          INSERT INTO calendars (family_id, name, color, is_default)
          VALUES (${familyId}, 'Imported Events', '#8B5CF6', false)
          RETURNING id
        `
        calendarId = newCalendar[0].id
      } else {
        calendarId = calendars[0].id
      }

      for (const raw of eventBlocks) {
        const status = parseIcsField(raw, 'STATUS')
        if (status === 'CANCELLED') { eventsSkipped++; continue }

        const summary = parseIcsField(raw, 'SUMMARY')
        const dtStart = parseIcsField(raw, 'DTSTART')
        if (!summary || !dtStart) { eventsSkipped++; continue }

        const isAllDay = !/T/.test(dtStart)
        const startTime = parseIcsDateValue(dtStart)
        const dtEnd = parseIcsField(raw, 'DTEND')
        const endTime = dtEnd ? parseIcsDateValue(dtEnd) : startTime

        // Atomically claim (family, title, start time) before creating
        // anything. The claim's UNIQUE constraint is the "already
        // imported?" check - no gap for a double-click or a concurrent
        // re-import to slip through, unlike the old SELECT-then-INSERT.
        const claimed = await sql`
          INSERT INTO ics_import_records (family_id, item_type, title, occurs_at)
          VALUES (${familyId}, 'event', ${summary}, ${startTime})
          ON CONFLICT (family_id, item_type, title, occurs_at) DO NOTHING
          RETURNING id
        `
        if (claimed.length === 0) { eventsSkipped++; continue }

        await sql`
          INSERT INTO events (
            calendar_id, title, description, location,
            start_time, end_time, is_all_day, status,
            visibility, created_by_id
          ) VALUES (
            ${calendarId}, ${summary}, ${parseIcsField(raw, 'DESCRIPTION')}, ${parseIcsField(raw, 'LOCATION')},
            ${startTime}, ${endTime}, ${isAllDay}, 'APPROVED', 'FAMILY', ${user.id}
          )
        `
        eventsImported++
      }
    }

    // --- Tasks (VTODO -> tasks table) ---
    const todoBlocks = splitIcsComponents(icsText, 'VTODO').slice(0, MAX_ITEMS_PER_TYPE)
    let tasksImported = 0
    let tasksSkipped = 0

    for (const raw of todoBlocks) {
      const summary = parseIcsField(raw, 'SUMMARY')
      if (!summary) { tasksSkipped++; continue }

      const due = parseIcsField(raw, 'DUE')
      const dueDate = due ? parseIcsDateValue(due) : null
      const todoStatus = parseIcsField(raw, 'STATUS')
      const taskStatus = todoStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING'

      // Same atomic claim-ticket approach as the events loop above. Note:
      // a NULL dueDate means every such task has a distinct claim (Postgres
      // treats NULLs as distinct under a UNIQUE constraint), so tasks with
      // no due date aren't raced-protected the same way - an acceptable gap
      // since there's no time component to actually collide on.
      const claimed = await sql`
        INSERT INTO ics_import_records (family_id, item_type, title, occurs_at)
        VALUES (${familyId}, 'task', ${summary}, ${dueDate})
        ON CONFLICT (family_id, item_type, title, occurs_at) DO NOTHING
        RETURNING id
      `
      if (claimed.length === 0) { tasksSkipped++; continue }

      const task = await sql`
        INSERT INTO tasks (
          family_id, title, description, created_by_id,
          due_date, priority, category, status
        ) VALUES (
          ${familyId}, ${summary}, ${parseIcsField(raw, 'DESCRIPTION')}, ${user.id},
          ${dueDate}, 'MEDIUM', 'OTHER', ${taskStatus}
        )
        RETURNING id
      `

      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${task[0].id}, ${user.id}, 'CREATED', ${JSON.stringify({ title: summary, imported: true, source: sourceLabel })}::jsonb)
      `
      tasksImported++
    }

    if (eventBlocks.length === 0 && todoBlocks.length === 0) {
      return NextResponse.json({ success: false, error: 'No events or tasks found in that calendar file' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      eventsImported,
      eventsSkipped,
      tasksImported,
      tasksSkipped,
      message: `Imported ${eventsImported} event(s) and ${tasksImported} task(s) from ${sourceLabel}` +
        (eventsSkipped || tasksSkipped ? ` (${eventsSkipped + tasksSkipped} already present, skipped)` : ''),
    })
  } catch (error) {
    console.error('iCal import error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to import calendar file' },
      { status: 500 }
    )
  }
}
