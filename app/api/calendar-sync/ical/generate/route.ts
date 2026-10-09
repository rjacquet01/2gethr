import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { ensureSyncSchema } from '@/lib/sync-schema'

// Lets a user get (or create) a standing subscription URL that any calendar
// app can subscribe to (Apple Calendar, Outlook, Google Calendar's "From
// URL" import, Fantastical, etc.) - this is what "integrating with other
// calendars" means here: rather than building a one-off OAuth integration
// per provider, publish a single feed that every calendar app already knows
// how to consume.

// GET - fetch the current subscription link, if one exists
export async function GET(request: NextRequest) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: error || 'Not authenticated' }, { status: 401 })
  }

  await ensureSyncSchema()
  const existing = await sql`
    SELECT ical_token, sync_enabled, feed_include_tasks, feed_include_reminders FROM calendar_sync_connections
    WHERE user_id = ${user.id} AND provider = 'apple'
  `

  if (existing.length === 0 || !existing[0].ical_token) {
    return NextResponse.json({ success: true, feedUrl: null })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return NextResponse.json({
    success: true,
    feedUrl: `${baseUrl}/api/calendar-sync/ical/feed/${existing[0].ical_token}`,
    enabled: existing[0].sync_enabled,
    includeTasks: existing[0].feed_include_tasks !== false,
    includeReminders: existing[0].feed_include_reminders !== false,
  })
}

// POST - create (or rotate) the subscription link
export async function POST(request: NextRequest) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: error || 'Not authenticated' }, { status: 401 })
  }

  const familyMembership = await sql`
    SELECT family_id FROM family_members
    WHERE user_id = ${user.id} AND is_active = true
    ORDER BY joined_at ASC
    LIMIT 1
  `

  if (familyMembership.length === 0) {
    return NextResponse.json({ success: false, error: 'You need to be part of a family first' }, { status: 400 })
  }

  await ensureSyncSchema()
  const familyId = familyMembership[0].family_id
  const icalToken = crypto.randomBytes(24).toString('hex')

  const existing = await sql`
    SELECT id FROM calendar_sync_connections
    WHERE user_id = ${user.id} AND provider = 'apple'
  `

  if (existing.length > 0) {
    await sql`
      UPDATE calendar_sync_connections
      SET ical_token = ${icalToken}, family_id = ${familyId}, sync_enabled = true,
          -- Only a link-only row is export-only; never downgrade a live CalDAV connection.
          sync_direction = CASE WHEN external_calendar_id IS NULL THEN 'export' ELSE sync_direction END,
          updated_at = NOW()
      WHERE id = ${existing[0].id}
    `
  } else {
    await sql`
      INSERT INTO calendar_sync_connections (
        user_id, family_id, provider, ical_token, sync_enabled, sync_direction
      ) VALUES (
        ${user.id}, ${familyId}, 'apple', ${icalToken}, true, 'export'
      )
    `
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return NextResponse.json({
    success: true,
    feedUrl: `${baseUrl}/api/calendar-sync/ical/feed/${icalToken}`,
  })
}

// DELETE - disable the subscription link (keeps the row so re-enabling
// doesn't need a fresh token, but the old URL stops serving data)
export async function DELETE(request: NextRequest) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: error || 'Not authenticated' }, { status: 401 })
  }

  await sql`
    UPDATE calendar_sync_connections
    SET sync_enabled = false, updated_at = NOW()
    WHERE user_id = ${user.id} AND provider = 'apple'
  `

  return NextResponse.json({ success: true })
}

// PATCH - choose whether the link includes tasks and/or reminders
export async function PATCH(request: NextRequest) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: error || 'Not authenticated' }, { status: 401 })
  }
  await ensureSyncSchema()
  const body = await request.json().catch(() => ({}))
  const includeTasks = typeof body.includeTasks === 'boolean' ? body.includeTasks : null
  const includeReminders = typeof body.includeReminders === 'boolean' ? body.includeReminders : null

  await sql`
    UPDATE calendar_sync_connections
    SET feed_include_tasks = COALESCE(${includeTasks}, feed_include_tasks),
        feed_include_reminders = COALESCE(${includeReminders}, feed_include_reminders),
        updated_at = NOW()
    WHERE user_id = ${user.id} AND provider = 'apple'
  `
  return NextResponse.json({ success: true })
}
