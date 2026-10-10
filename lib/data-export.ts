import { sql } from '@/lib/db'

/**
 * Account data export ("data portability").
 *
 * Collects everything Togethr stores about a user into a list of sections.
 * Design rules:
 *  - Every section is independent: a failing query is recorded in `errors`
 *    and the rest of the export still succeeds.
 *  - No arbitrary row caps. Large tables (location pings) are paged with a
 *    keyset cursor and only stop at a very high safety ceiling, which is
 *    reported in the manifest if it is ever hit.
 *  - Secrets are never exported: password hashes, 2FA secrets and backup
 *    codes, session / device / reset token values, push and OAuth tokens.
 *  - Data about *other* people is limited to what is needed to make sense of
 *    the user's own data (first name, last initial-free display name, role).
 *    Other members' emails, phones and locations are not included.
 */

export type ExportRow = Record<string, unknown>

export interface ExportSection {
  name: string
  description: string
  rows: ExportRow[]
  truncated?: boolean
}

export interface ExportManifest {
  generatedAt: string
  userId: string
  format: string
  sections: { name: string; rows: number; truncated: boolean }[]
  errors: { section: string; message: string }[]
  excluded: string[]
  notes: string[]
}

export interface UserExport {
  manifest: ExportManifest
  sections: ExportSection[]
}

// Safety ceiling only, to keep one request inside the function time/memory
// budget. A user would need years of continuous 15-second pings to hit it.
export const MAX_PINGS = 500_000
const PING_PAGE = 5_000

const EXCLUDED = [
  'Password hash, two-factor secrets and backup codes',
  'Session, refresh, device and password-reset token values',
  'Push notification tokens and keys, calendar-sync OAuth tokens',
  'Other family members’ email addresses, phone numbers and locations',
  'Internal staff notes on support tickets',
]

type Id = string

async function collectPings(userId: Id): Promise<{ rows: ExportRow[]; truncated: boolean }> {
  const rows: ExportRow[] = []
  let cursorTs: string | null = null
  let cursorId: string | null = null
  while (rows.length < MAX_PINGS) {
    const page: ExportRow[] =
      cursorTs === null
        ? ((await sql`
            SELECT id, latitude, longitude, accuracy, altitude, speed, heading, battery_level, timestamp
            FROM location_pings WHERE user_id = ${userId}
            ORDER BY timestamp DESC, id DESC LIMIT ${PING_PAGE}
          `) as ExportRow[])
        : ((await sql`
            SELECT id, latitude, longitude, accuracy, altitude, speed, heading, battery_level, timestamp
            FROM location_pings
            WHERE user_id = ${userId} AND (timestamp, id) < (${cursorTs}::timestamptz, ${cursorId})
            ORDER BY timestamp DESC, id DESC LIMIT ${PING_PAGE}
          `) as ExportRow[])
    if (page.length === 0) return { rows, truncated: false }
    rows.push(...page)
    const last = page[page.length - 1]
    cursorTs = new Date(last.timestamp as string).toISOString()
    cursorId = last.id as string
    if (page.length < PING_PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

export async function collectUserExport(userId: Id, format = 'json'): Promise<UserExport> {
  const sections: ExportSection[] = []
  const errors: { section: string; message: string }[] = []

  async function run(
    name: string,
    description: string,
    fn: () => Promise<ExportRow[] | { rows: ExportRow[]; truncated: boolean }>
  ) {
    try {
      const out = await fn()
      if (Array.isArray(out)) sections.push({ name, description, rows: out })
      else sections.push({ name, description, rows: out.rows, truncated: out.truncated })
    } catch (e) {
      errors.push({ section: name, message: e instanceof Error ? e.message : String(e) })
      sections.push({ name, description, rows: [] })
    }
  }

  // Families the user belongs to (any status), used by many sections.
  let familyIds: Id[] = []
  let ownedFamilyIds: Id[] = []
  let guardianFamilyIds: Id[] = []
  try {
    const m = (await sql`
      SELECT fm.family_id, fm.role, f.owner_id
      FROM family_members fm JOIN families f ON f.id = fm.family_id
      WHERE fm.user_id = ${userId}
    `) as ExportRow[]
    familyIds = m.map((r) => r.family_id as string)
    ownedFamilyIds = m.filter((r) => r.owner_id === userId).map((r) => r.family_id as string)
    guardianFamilyIds = m
      .filter((r) => r.role === 'PARENT' || r.role === 'GUARDIAN' || r.owner_id === userId)
      .map((r) => r.family_id as string)
  } catch (e) {
    errors.push({ section: 'Families lookup', message: e instanceof Error ? e.message : String(e) })
  }
  const hasFam = familyIds.length > 0

  await run('Profile', 'Your account profile and settings', async () =>
    (await sql`
      SELECT id, email, email_verified, first_name, last_name, phone, timezone, date_of_birth,
             profile_photo_url, is_active, last_login_at, created_at, updated_at,
             email_notifications, sms_notifications, push_notifications,
             notification_preferences, two_factor_enabled
      FROM users WHERE id = ${userId}
    `) as ExportRow[]
  )

  await run('Consents', 'Consents you granted or revoked', async () =>
    (await sql`
      SELECT type, granted, version, granted_at, revoked_at, ip_address, user_agent
      FROM consents WHERE user_id = ${userId} ORDER BY granted_at DESC
    `) as ExportRow[]
  )

  await run('Notification Preferences', 'Which notifications you receive and how', async () =>
    (await sql`SELECT * FROM notification_preferences WHERE user_id = ${userId}`) as ExportRow[]
  )

  await run('Reminder Settings', 'Default reminder and digest settings', async () =>
    (await sql`SELECT * FROM reminder_settings WHERE user_id = ${userId}`) as ExportRow[]
  )

  await run('Families', 'Families you belong to and your role and permissions in each', async () =>
    (await sql`
      SELECT f.id AS family_id, f.name AS family_name, fm.role, fm.nickname, fm.color, fm.emoji, fm.is_active,
             fm.joined_at, fm.can_create_events, fm.requires_event_approval, fm.can_override_conflicts,
             fm.can_view_family_calendar, fm.can_invite_members, (f.owner_id = ${userId}) AS is_owner, f.created_at
      FROM family_members fm JOIN families f ON f.id = fm.family_id
      WHERE fm.user_id = ${userId} ORDER BY f.name
    `) as ExportRow[]
  )

  await run('Family Roster', 'Names and roles of the people in your families (no contact details)', async () =>
    hasFam
      ? ((await sql`
          SELECT f.name AS family_name, u.first_name, fm.nickname, fm.role, fm.is_active, fm.joined_at
          FROM family_members fm
          JOIN families f ON f.id = fm.family_id
          JOIN users u ON u.id = fm.user_id
          WHERE fm.family_id = ANY(${familyIds}) ORDER BY f.name, fm.joined_at
        `) as ExportRow[])
      : []
  )

  await run('Child Profiles', 'Child profiles in families where you are a parent or guardian', async () =>
    (await sql`
      SELECT cp.id, cp.display_name, cp.age, cp.grade, cp.school, cp.emergency_notes, cp.avatar_url,
             f.name AS family_name, cp.created_at, cp.updated_at
      FROM child_profiles cp
      JOIN family_members fm ON fm.id = cp.family_member_id
      JOIN families f ON f.id = fm.family_id
      WHERE fm.user_id = ${userId}
         OR fm.family_id = ANY(${guardianFamilyIds.length ? guardianFamilyIds : ['']})
      ORDER BY f.name, cp.display_name
    `) as ExportRow[]
  )

  await run('Location Settings', 'Your location sharing mode and interval', async () =>
    (await sql`
      SELECT ls.mode, ls.share_with_family, ls.update_interval_sec, ls.last_mode_change, ls.created_at, ls.updated_at,
             f.name AS family_name
      FROM location_settings ls
      JOIN family_members fm ON fm.id = ls.family_member_id
      JOIN families f ON f.id = fm.family_id
      WHERE fm.user_id = ${userId}
    `) as ExportRow[]
  )

  await run('Location History', 'Every location ping recorded for you (newest first)', () => collectPings(userId))

  await run('Geofence Events', 'Arrivals and departures at saved places', async () =>
    (await sql`
      SELECT ge.event_type, ge.latitude, ge.longitude, ge.timestamp, sp.name AS place_name
      FROM geofence_events ge LEFT JOIN saved_places sp ON sp.id = ge.saved_place_id
      WHERE ge.user_id = ${userId} ORDER BY ge.timestamp DESC
    `) as ExportRow[]
  )

  await run('Location Requests', 'Requests to check someone’s location, sent by or to you', async () =>
    (await sql`
      SELECT id, CASE WHEN requester_user_id = ${userId} THEN 'sent' ELSE 'received' END AS direction,
             status, created_at, fulfilled_at, expires_at
      FROM location_requests
      WHERE requester_user_id = ${userId} OR target_user_id = ${userId} ORDER BY created_at DESC
    `) as ExportRow[]
  )

  await run('Background Devices', 'Devices authorised for background location (no token values)', async () =>
    (await sql`
      SELECT created_at, last_used_at, revoked_at FROM location_device_tokens
      WHERE user_id = ${userId} ORDER BY created_at DESC
    `) as ExportRow[]
  )

  await run('Saved Places', 'Places saved by your families', async () =>
    hasFam
      ? ((await sql`
          SELECT sp.id, f.name AS family_name, sp.name, sp.address, sp.latitude, sp.longitude, sp.radius,
                 sp.geofence_enabled, sp.alert_on_arrival, sp.alert_on_departure, sp.icon, sp.color,
                 sp.notify_channels, sp.created_at, sp.updated_at
          FROM saved_places sp JOIN families f ON f.id = sp.family_id
          WHERE sp.family_id = ANY(${familyIds}) ORDER BY f.name, sp.name
        `) as ExportRow[])
      : []
  )

  await run('Calendars', 'Calendars in your families', async () =>
    hasFam
      ? ((await sql`
          SELECT c.id, f.name AS family_name, c.name, c.color, c.is_default, c.is_shared, c.created_at
          FROM calendars c JOIN families f ON f.id = c.family_id
          WHERE c.family_id = ANY(${familyIds}) ORDER BY f.name, c.name
        `) as ExportRow[])
      : []
  )

  await run('Events', 'Events you created or were invited to', async () =>
    (await sql`
      SELECT e.id, e.title, e.description, e.location, sp.name AS place_name, sp.address AS place_address,
             e.start_time, e.end_time, e.is_all_day, e.status, e.visibility, e.category, e.color,
             e.is_recurring, rr.frequency AS repeats, rr.interval AS repeat_interval, rr.days_of_week AS repeat_days,
             rr.end_date AS repeat_until, e.reminder_minutes, e.notify_channels, c.name AS calendar_name,
             (e.created_by_id = ${userId}) AS created_by_you, ep.status AS your_response,
             e.created_at, e.updated_at
      FROM events e
      JOIN calendars c ON c.id = e.calendar_id
      LEFT JOIN saved_places sp ON sp.id = e.saved_place_id
      LEFT JOIN recurrence_rules rr ON rr.id = e.recurrence_rule_id
      LEFT JOIN event_participants ep ON ep.event_id = e.id AND ep.user_id = ${userId}
      WHERE e.created_by_id = ${userId} OR ep.user_id = ${userId}
      ORDER BY e.start_time DESC
    `) as ExportRow[]
  )

  await run('Event Requests', 'Event approval requests you made or reviewed', async () =>
    (await sql`
      SELECT er.id, e.title AS event_title,
             CASE WHEN er.requestor_id = ${userId} THEN 'requested by you' ELSE 'reviewed by you' END AS role,
             er.status, er.request_notes, er.response_notes, er.requested_at, er.responded_at
      FROM event_requests er LEFT JOIN events e ON e.id = er.event_id
      WHERE er.requestor_id = ${userId} OR er.approver_id = ${userId} ORDER BY er.requested_at DESC
    `) as ExportRow[]
  )

  await run('Tasks', 'Tasks you created, were assigned, completed or approved', async () =>
    (await sql`
      SELECT t.id, t.title, t.description, t.category, t.priority, t.status, t.due_date, t.due_time,
             t.is_recurring, t.recurrence_rule, t.points_value, t.reward_description,
             t.reminder_enabled, t.reminder_minutes, t.notify_channels, t.rejection_reason,
             cu.first_name AS created_by, au.first_name AS assigned_to, apu.first_name AS approved_by,
             (t.created_by_id = ${userId}) AS created_by_you, (t.assigned_to_id = ${userId}) AS assigned_to_you,
             t.completed_at, t.approved_at, t.created_at, t.updated_at
      FROM tasks t
      LEFT JOIN users cu ON cu.id = t.created_by_id
      LEFT JOIN users au ON au.id = t.assigned_to_id
      LEFT JOIN users apu ON apu.id = t.approved_by_id
      WHERE t.created_by_id = ${userId} OR t.assigned_to_id = ${userId}
         OR t.completed_by_id = ${userId} OR t.approved_by_id = ${userId}
      ORDER BY t.created_at DESC
    `) as ExportRow[]
  )

  await run('Task Comments', 'Comments you wrote on tasks', async () =>
    (await sql`
      SELECT tc.id, t.title AS task_title, tc.message, tc.created_at, tc.updated_at
      FROM task_comments tc LEFT JOIN tasks t ON t.id = tc.task_id
      WHERE tc.user_id = ${userId} ORDER BY tc.created_at DESC
    `) as ExportRow[]
  )

  await run('Task History', 'Changes you made to tasks', async () =>
    (await sql`
      SELECT th.action, t.title AS task_title, th.old_value, th.new_value, th.created_at
      FROM task_history th LEFT JOIN tasks t ON t.id = th.task_id
      WHERE th.user_id = ${userId} ORDER BY th.created_at DESC
    `) as ExportRow[]
  )

  await run('Reminders', 'Reminders you created or that are set for you', async () =>
    (await sql`
      SELECT id, title, description, remind_at, status, is_recurring, recurrence_rule, notify_channels, sent_at, created_at
      FROM reminders WHERE user_id = ${userId} OR created_by_id = ${userId} ORDER BY remind_at DESC
    `) as ExportRow[]
  )

  await run('Favorites', 'Items you marked as favourites', async () =>
    (await sql`SELECT item_type, item_id, created_at FROM user_favorites WHERE user_id = ${userId}`) as ExportRow[]
  )

  await run('Notifications', 'Notifications sent to you', async () =>
    (await sql`
      SELECT n.type, n.title, n.body, n.is_read, n.read_at, n.sent_at, n.created_at,
             (SELECT string_agg(d.channel || ':' || d.status, ', ') FROM notification_deliveries d WHERE d.notification_id = n.id) AS deliveries
      FROM notifications n WHERE n.user_id = ${userId} ORDER BY n.created_at DESC
    `) as ExportRow[]
  )

  await run('Devices', 'Devices registered for push notifications (no token values)', async () =>
    (await sql`
      SELECT platform, device_info, is_active, last_used_at, created_at FROM push_tokens
      WHERE user_id = ${userId} ORDER BY created_at DESC
    `) as ExportRow[]
  )

  await run('SOS Alerts', 'SOS alerts you sent and their delivery results', async () =>
    (await sql`
      SELECT se.id, se.message, se.latitude, se.longitude, se.location_source, se.created_at,
             (SELECT string_agg(sd.channel || ':' || sd.status, ', ') FROM sos_deliveries sd WHERE sd.event_id = se.id) AS deliveries
      FROM sos_events se WHERE se.user_id = ${userId} ORDER BY se.created_at DESC
    `) as ExportRow[]
  )

  await run('SOS Alerts Received', 'SOS alerts delivered to you', async () =>
    (await sql`
      SELECT se.id, u.first_name AS sent_by, se.message, se.created_at, sd.channel, sd.status
      FROM sos_deliveries sd
      JOIN sos_events se ON se.id = sd.event_id
      LEFT JOIN users u ON u.id = se.user_id
      WHERE sd.recipient_user_id = ${userId} AND se.user_id <> ${userId} ORDER BY se.created_at DESC
    `) as ExportRow[]
  )

  await run('Calendar Connections', 'Connected external calendars (no tokens)', async () =>
    (await sql`
      SELECT provider, provider_account_email, sync_enabled, sync_direction, sync_tasks, sync_interval_minutes,
             task_sync_interval_minutes, feed_include_tasks, feed_include_reminders, last_sync_at, last_sync_status, created_at
      FROM calendar_sync_connections WHERE user_id = ${userId}
    `) as ExportRow[]
  )

  await run('Subscriptions', 'Subscription plans of families you own', async () =>
    ownedFamilyIds.length
      ? ((await sql`
          SELECT f.name AS family_name, s.tier, s.status, s.current_period_start, s.current_period_end,
                 s.cancel_at_period_end, s.trial_ends_at, s.stripe_customer_id, s.stripe_subscription_id,
                 s.stripe_price_id, s.created_at, s.updated_at
          FROM subscriptions s JOIN families f ON f.id = s.family_id
          WHERE s.family_id = ANY(${ownedFamilyIds})
        `) as ExportRow[])
      : []
  )

  await run('Payments', 'Payments for subscriptions of families you own', async () =>
    ownedFamilyIds.length
      ? ((await sql`
          SELECT pt.id, pt.amount, pt.currency, pt.status, pt.description, pt.stripe_payment_id, pt.created_at,
                 s.tier AS subscription_tier
          FROM payment_transactions pt JOIN subscriptions s ON s.id = pt.subscription_id
          WHERE s.family_id = ANY(${ownedFamilyIds}) ORDER BY pt.created_at DESC
        `) as ExportRow[])
      : []
  )

  await run('Support Tickets', 'Support tickets you opened', async () =>
    (await sql`
      SELECT ticket_number, category, priority, status, subject, description, resolution_notes,
             created_at, first_response_at, resolved_at, closed_at
      FROM support_tickets WHERE user_id = ${userId} ORDER BY created_at DESC
    `) as ExportRow[]
  )

  await run('Support Messages', 'Messages on your support tickets (staff-only notes excluded)', async () =>
    (await sql`
      SELECT st.ticket_number, m.sender_type, m.message, m.created_at
      FROM support_ticket_messages m JOIN support_tickets st ON st.id = m.ticket_id
      WHERE st.user_id = ${userId} AND m.is_internal_note = false ORDER BY st.ticket_number, m.created_at
    `) as ExportRow[]
  )

  await run('Sign-in Sessions', 'Your sign-in sessions (no token values)', async () =>
    (await sql`
      SELECT created_at, expires_at, revoked_at, user_agent, ip_address FROM refresh_tokens
      WHERE user_id = ${userId} ORDER BY created_at DESC
    `) as ExportRow[]
  )

  await run('Failed Sign-ins', 'Failed sign-in attempts on your account (last 30 days)', async () =>
    (await sql`
      SELECT created_at, ip FROM login_attempts WHERE user_id = ${userId} ORDER BY created_at DESC
    `) as ExportRow[]
  )

  await run('Account Activity', 'Audit log of actions on your account', async () =>
    (await sql`
      SELECT action, entity_type, entity_id, old_value, new_value, metadata, ip_address, user_agent, created_at
      FROM audit_logs WHERE user_id = ${userId} ORDER BY created_at DESC
    `) as ExportRow[]
  )

  const notes: string[] = [
    'Timestamps are ISO 8601 in UTC.',
    'Data about other people is limited to first names and roles.',
  ]
  const manifest: ExportManifest = {
    generatedAt: new Date().toISOString(),
    userId,
    format,
    sections: sections.map((s) => ({ name: s.name, rows: s.rows.length, truncated: !!s.truncated })),
    errors,
    excluded: EXCLUDED,
    notes,
  }
  if (sections.some((s) => s.truncated)) {
    notes.push(`Location History was limited to the most recent ${MAX_PINGS.toLocaleString()} pings.`)
  }
  if (errors.length) {
    notes.push('Some sections could not be read and are empty; see "errors". Contact support if this persists.')
  }
  return { manifest, sections }
}
