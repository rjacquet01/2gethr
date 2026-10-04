import { sql } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encryption'
import { listCalDavItems, putCalDavItem, buildVEvent, parseIcsField, CalDavCredentials } from '@/lib/services/caldav'

/**
 * Connection-row-scoped calendar sync logic, shared by:
 *  - app/api/calendar-sync/google/sync/route.ts and .../apple/sync/route.ts
 *    (session-scoped "Sync Now" button - looks up the calling user's own
 *    connection, then delegates here)
 *  - app/api/cron/calendar-sync/route.ts (iterates every due connection
 *    across all users/families - has no session, so it passes in the
 *    connection row + familyId + userId it already fetched itself)
 *
 * Previously this logic lived only inline in the two manual-sync routes,
 * keyed off getUserFromRequest(request), which made it impossible to run
 * from a cron job that has no request/session to begin with.
 */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

export interface SyncResult {
  imported: number
  exported: number
}

export interface GoogleConnectionRow {
  id: string
  access_token_encrypted: string
  refresh_token_encrypted: string | null
  token_expires_at: string | Date
  external_calendar_id: string
  sync_direction: 'import' | 'export' | 'both'
}

export interface AppleConnectionRow {
  id: string
  access_token_encrypted: string | null
  external_calendar_id: string | null
  provider_account_email: string
  sync_direction: 'import' | 'export' | 'both'
}

async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) return null

    const tokens = await response.json()
    return {
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    }
  } catch {
    return null
  }
}

/**
 * Runs a Google Calendar sync for one connection row. Throws on failure
 * (callers - the manual-sync route and the cron route - each decide how to
 * report that).
 */
export async function syncGoogleConnection(
  connection: GoogleConnectionRow,
  familyId: string,
  userId: string
): Promise<SyncResult> {
  let accessToken = decrypt(connection.access_token_encrypted)

  if (new Date(connection.token_expires_at) < new Date()) {
    if (!connection.refresh_token_encrypted) {
      throw new Error('Token expired and no refresh token available')
    }

    const refreshToken = decrypt(connection.refresh_token_encrypted)
    const newTokens = await refreshGoogleAccessToken(refreshToken)

    if (!newTokens) {
      throw new Error('Failed to refresh token')
    }

    const encryptedNewToken = encrypt(newTokens.accessToken)
    await sql`
      UPDATE calendar_sync_connections
      SET
        access_token_encrypted = ${encryptedNewToken},
        token_expires_at = ${newTokens.expiresAt.toISOString()},
        updated_at = NOW()
      WHERE id = ${connection.id}
    `

    accessToken = newTokens.accessToken
  }

  const syncDirection = connection.sync_direction
  let importedCount = 0
  let exportedCount = 0

  if (syncDirection === 'import' || syncDirection === 'both') {
    const googleEventsResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${connection.external_calendar_id}/events?` +
        new URLSearchParams({
          timeMin: new Date().toISOString(),
          timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100',
        }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (googleEventsResponse.ok) {
      const googleEvents = await googleEventsResponse.json()

      const calendars = await sql`
        SELECT id FROM calendars
        WHERE family_id = ${familyId} AND name = 'Google Calendar'
        LIMIT 1
      `

      let calendarId: string
      if (calendars.length === 0) {
        const newCalendar = await sql`
          INSERT INTO calendars (family_id, name, color, is_default)
          VALUES (${familyId}, 'Google Calendar', '#4285F4', false)
          RETURNING id
        `
        calendarId = newCalendar[0].id
      } else {
        calendarId = calendars[0].id
      }

      for (const gEvent of googleEvents.items || []) {
        if (!gEvent.id || !gEvent.summary) continue

        // Atomically reserve this external event before creating anything
        // locally. Overlapping sync runs (the 1-minute client timer, the
        // 5-minute cron, a manual "Sync Now" click) used to each do a
        // SELECT-then-INSERT check here - a TOCTOU gap that let two runs
        // both pass the "not yet synced" check and each create their own
        // duplicate local copy of the same Google event. The unique
        // constraint on (connection_id, external_event_id) makes this
        // INSERT itself the check: only one concurrent run can ever win it.
        const reserved = await sql`
          INSERT INTO synced_events (connection_id, external_event_id, sync_status, last_synced_at)
          VALUES (${connection.id}, ${gEvent.id}, 'synced', NOW())
          ON CONFLICT (connection_id, external_event_id) DO NOTHING
          RETURNING id
        `

        if (reserved.length > 0) {
          const startTime = gEvent.start?.dateTime || gEvent.start?.date
          const endTime = gEvent.end?.dateTime || gEvent.end?.date
          const isAllDay = !gEvent.start?.dateTime

          const newEvent = await sql`
            INSERT INTO events (
              calendar_id, title, description, location,
              start_time, end_time, is_all_day, status,
              visibility, created_by_id
            ) VALUES (
              ${calendarId}, ${gEvent.summary}, ${gEvent.description || null},
              ${gEvent.location || null}, ${startTime}, ${endTime},
              ${isAllDay}, 'APPROVED', 'FAMILY', ${userId}
            )
            RETURNING id
          `

          await sql`
            UPDATE synced_events SET local_event_id = ${newEvent[0].id} WHERE id = ${reserved[0].id}
          `

          importedCount++
        }
      }
    }
  }

  if (syncDirection === 'export' || syncDirection === 'both') {
    const localEvents = await sql`
      SELECT e.id, e.title, e.description, e.location,
             e.start_time, e.end_time, e.is_all_day
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      LEFT JOIN synced_events se ON se.local_event_id = e.id
        AND se.connection_id = ${connection.id}
      WHERE c.family_id = ${familyId}
      AND e.status != 'CANCELLED'
      AND e.start_time >= NOW()
      AND se.id IS NULL
      LIMIT 50
    `

    for (const event of localEvents) {
      // Same race as the import side, mirrored: reserve this local event
      // with a placeholder external id BEFORE posting to Google, so a
      // second concurrent sync run can't also pick up this still-unsynced
      // event and create a second Google event for it. Real id swapped in
      // after Google confirms creation; reservation released on failure so
      // a later sync can retry.
      const placeholderExternalId = `pending:${event.id}`
      const reserved = await sql`
        INSERT INTO synced_events (connection_id, local_event_id, external_event_id, sync_status, last_synced_at)
        VALUES (${connection.id}, ${event.id}, ${placeholderExternalId}, 'pending', NOW())
        ON CONFLICT (connection_id, external_event_id) DO NOTHING
        RETURNING id
      `

      if (reserved.length === 0) continue

      const googleEvent = {
        summary: event.title,
        description: event.description,
        location: event.location,
        start: event.is_all_day
          ? { date: new Date(event.start_time).toISOString().split('T')[0] }
          : { dateTime: new Date(event.start_time).toISOString() },
        end: event.is_all_day
          ? { date: new Date(event.end_time).toISOString().split('T')[0] }
          : { dateTime: new Date(event.end_time).toISOString() },
      }

      const createResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${connection.external_calendar_id}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(googleEvent),
        }
      )

      if (createResponse.ok) {
        const createdEvent = await createResponse.json()

        await sql`
          UPDATE synced_events
          SET external_event_id = ${createdEvent.id}, sync_status = 'synced', last_synced_at = NOW()
          WHERE id = ${reserved[0].id}
        `

        exportedCount++
      } else {
        await sql`DELETE FROM synced_events WHERE id = ${reserved[0].id}`
      }
    }
  }

  await sql`
    UPDATE calendar_sync_connections
    SET last_sync_at = NOW(), updated_at = NOW()
    WHERE id = ${connection.id}
  `

  return { imported: importedCount, exported: exportedCount }
}

function parseIcsDate(value: string): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/)
  if (!m) return new Date().toISOString()
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
}

/**
 * Runs an Apple (iCloud CalDAV) calendar sync for one connection row.
 * Throws on failure, same contract as syncGoogleConnection above.
 */
export async function syncAppleConnection(
  connection: AppleConnectionRow,
  familyId: string,
  userId: string
): Promise<SyncResult> {
  if (!connection.access_token_encrypted || !connection.external_calendar_id) {
    throw new Error(
      "Apple Calendar isn't fully connected. Reconnect it with your Apple ID and an app-specific password."
    )
  }

  const creds: CalDavCredentials = {
    username: connection.provider_account_email,
    password: decrypt(connection.access_token_encrypted),
  }
  const eventsCalendarUrl: string = connection.external_calendar_id
  const syncDirection = connection.sync_direction

  let importedCount = 0
  let exportedCount = 0

  if (syncDirection === 'import' || syncDirection === 'both') {
    const items = await listCalDavItems(eventsCalendarUrl, creds, 'VEVENT')

    const calendars = await sql`
      SELECT id FROM calendars WHERE family_id = ${familyId} AND name = 'Apple Calendar' LIMIT 1
    `
    let calendarId: string
    if (calendars.length === 0) {
      const newCalendar = await sql`
        INSERT INTO calendars (family_id, name, color, is_default)
        VALUES (${familyId}, 'Apple Calendar', '#EA4335', false)
        RETURNING id
      `
      calendarId = newCalendar[0].id
    } else {
      calendarId = calendars[0].id
    }

    for (const item of items) {
      // Same atomic-reservation fix as the Google import path above: the
      // INSERT's unique constraint on (connection_id, external_event_id)
      // IS the "already synced?" check now, closing the race between
      // overlapping sync runs.
      const reserved = await sql`
        INSERT INTO synced_events (connection_id, external_event_id, sync_status, last_synced_at)
        VALUES (${connection.id}, ${item.uid}, 'synced', NOW())
        ON CONFLICT (connection_id, external_event_id) DO NOTHING
        RETURNING id
      `
      if (reserved.length === 0) continue

      const summary = parseIcsField(item.raw, 'SUMMARY')
      const dtStart = parseIcsField(item.raw, 'DTSTART')
      const dtEnd = parseIcsField(item.raw, 'DTEND')
      if (!summary || !dtStart) {
        await sql`DELETE FROM synced_events WHERE id = ${reserved[0].id}`
        continue
      }

      const isAllDay = !/T/.test(dtStart)
      const startTime = parseIcsDate(dtStart)
      const endTime = dtEnd ? parseIcsDate(dtEnd) : startTime

      const newEvent = await sql`
        INSERT INTO events (
          calendar_id, title, description, location,
          start_time, end_time, is_all_day, status,
          visibility, created_by_id
        ) VALUES (
          ${calendarId}, ${summary}, ${parseIcsField(item.raw, 'DESCRIPTION')}, ${parseIcsField(item.raw, 'LOCATION')},
          ${startTime}, ${endTime}, ${isAllDay}, 'APPROVED', 'FAMILY', ${userId}
        )
        RETURNING id
      `

      await sql`
        UPDATE synced_events SET local_event_id = ${newEvent[0].id} WHERE id = ${reserved[0].id}
      `
      importedCount++
    }
  }

  if (syncDirection === 'export' || syncDirection === 'both') {
    const localEvents = await sql`
      SELECT e.id, e.title, e.description, e.location, e.start_time, e.end_time, e.is_all_day
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      LEFT JOIN synced_events se ON se.local_event_id = e.id AND se.connection_id = ${connection.id}
      WHERE c.family_id = ${familyId}
      AND e.status != 'CANCELLED'
      AND e.start_time >= NOW()
      AND se.id IS NULL
      LIMIT 50
    `

    for (const event of localEvents) {
      const uid = `togethr-${event.id}@togethr.app`

      // uid is deterministic per local event, so reserving it up front (via
      // the same ON CONFLICT trick used elsewhere in this file) is enough
      // to stop a second concurrent sync run from also exporting it.
      const reserved = await sql`
        INSERT INTO synced_events (connection_id, local_event_id, external_event_id, sync_status, last_synced_at)
        VALUES (${connection.id}, ${event.id}, ${uid}, 'synced', NOW())
        ON CONFLICT (connection_id, external_event_id) DO NOTHING
        RETURNING id
      `
      if (reserved.length === 0) continue

      const itemUrl = `${eventsCalendarUrl}${eventsCalendarUrl.endsWith('/') ? '' : '/'}${uid}.ics`
      const ics = buildVEvent({
        uid,
        title: event.title,
        description: event.description,
        location: event.location,
        start: new Date(event.start_time),
        end: new Date(event.end_time),
        allDay: event.is_all_day,
      })

      const ok = await putCalDavItem(itemUrl, creds, ics)
      if (ok) {
        exportedCount++
      } else {
        await sql`DELETE FROM synced_events WHERE id = ${reserved[0].id}`
      }
    }
  }

  await sql`
    UPDATE calendar_sync_connections
    SET last_sync_at = NOW(), updated_at = NOW()
    WHERE id = ${connection.id}
  `

  return { imported: importedCount, exported: exportedCount }
}
