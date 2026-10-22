import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { createNotification, type NotificationChannel } from '@/lib/notifications'
import { actorNameInFamily } from '@/lib/member-names'
import { ensureReminderChildColumn } from '@/lib/reminder-schema'

const VALID_NOTIFY_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email', 'sms']
const VALID_STATUSES = ['PENDING', 'COMPLETED', 'DISMISSED', 'ARCHIVED']

async function loadReminder(reminderId: string, userId: string) {
  await ensureReminderChildColumn()
  const rows = await sql`
    SELECT r.*, fm.user_id as membership_user_id, fm.role as membership_role,
           (SELECT cfm.user_id FROM child_profiles cp JOIN family_members cfm ON cfm.id = cp.family_member_id
            WHERE cp.id = r.child_profile_id) as child_user_id
    FROM reminders r
    JOIN family_members fm ON fm.family_id = r.family_id AND fm.user_id = ${userId} AND fm.is_active = true
    WHERE r.id = ${reminderId}
  `
  const r = rows[0]
  if (!r) return null
  // Same privacy as the reminder lists: a personal reminder belongs to the
  // person it's for and whoever created it; a child's reminder also to
  // parents/guardians and the child's own login. (Guests: own/created only.)
  const own = r.user_id === userId || r.created_by_id === userId
  const supervisor = ['PARENT', 'GUARDIAN'].includes(r.membership_role)
  const childsReminder = !!r.child_profile_id && (r.child_user_id === userId || supervisor)
  // A kid's "Ask a parent" reminder: any parent/guardian can open it to decide.
  const awaitingParent = r.approval_status === 'PENDING_APPROVAL' && supervisor
  if (!own && !childsReminder && !awaitingParent) return null
  return r
}

// PATCH - edit a reminder, or change its status (complete/dismiss/restore/archive)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reminderId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { reminderId } = await params
    const reminder = await loadReminder(reminderId, user.id)
    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
    }

    const body = await request.json()
    const {
      title,
      description,
      remindAt,
      isRecurring,
      recurrenceRule,
      notifyChannels,
      status,
      action,
    } = body

    // A parent/guardian answers a kid's "Ask a parent" reminder.
    if (action === 'approve' || action === 'decline') {
      if (!['PARENT', 'GUARDIAN'].includes(reminder.membership_role)) {
        return NextResponse.json({ error: 'Only a parent or guardian can approve this' }, { status: 403 })
      }
      if (reminder.approval_status !== 'PENDING_APPROVAL') {
        return NextResponse.json({ error: 'This reminder is not waiting for approval' }, { status: 409 })
      }
      const decided = await sql`
        UPDATE reminders SET
          approval_status = ${action === 'approve' ? 'APPROVED' : 'DECLINED'},
          status = ${action === 'approve' ? reminder.status : 'DISMISSED'},
          updated_at = NOW()
        WHERE id = ${reminderId} AND approval_status = 'PENDING_APPROVAL'
        RETURNING *
      `
      if (decided.length === 0) {
        return NextResponse.json({ error: 'This reminder is not waiting for approval' }, { status: 409 })
      }
      const byName = await actorNameInFamily(reminder.family_id as string, user, 'A parent')
      await createNotification({
        userId: reminder.created_by_id,
        type: 'APPROVAL_RESPONSE',
        title: action === 'approve' ? 'Reminder approved' : 'Reminder declined',
        body: `${byName} ${action === 'approve' ? 'approved' : 'declined'} your reminder "${reminder.title}"`,
        data: { reminderId, familyId: reminder.family_id },
      }).catch((err) => console.error('Reminder approval response failed (non-fatal):', err))
      // Set for someone else: tell them now that it's approved.
      if (action === 'approve' && reminder.user_id !== reminder.created_by_id && reminder.user_id !== user.id) {
        await createNotification({
          userId: reminder.user_id,
          type: 'REMINDER',
          title: 'New reminder for you',
          body: `A reminder was set for you: "${reminder.title}"`,
          data: { reminderId, familyId: reminder.family_id, kind: 'reminder_assigned' },
        }).catch((err) => console.error('Reminder-assigned notification failed (non-fatal):', err))
      }
      return NextResponse.json({ data: decided[0] })
    }

    // Until a parent approves, the kid can't turn it on another way.
    if (reminder.approval_status === 'PENDING_APPROVAL' && status && !['PARENT', 'GUARDIAN'].includes(reminder.membership_role)) {
      return NextResponse.json({ error: 'This reminder is waiting for a parent' }, { status: 409 })
    }

    // A couple of UI shorthand actions, matching the pattern the Archive
    // page already uses for tasks/events (action: 'unarchive' etc.)
    let nextStatus: string | undefined
    if (action === 'complete') nextStatus = 'COMPLETED'
    else if (action === 'dismiss') nextStatus = 'DISMISSED'
    else if (action === 'restore') nextStatus = 'PENDING'
    else if (action === 'archive') nextStatus = 'ARCHIVED'
    else if (status) {
      const normalized = String(status).toUpperCase()
      if (!VALID_STATUSES.includes(normalized)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      nextStatus = normalized
    }

    const normalizedNotifyChannels: NotificationChannel[] | null | undefined =
      notifyChannels === undefined
        ? undefined
        : Array.isArray(notifyChannels) && notifyChannels.length > 0
          ? notifyChannels.filter((c: unknown): c is NotificationChannel =>
              typeof c === 'string' && (VALID_NOTIFY_CHANNELS as string[]).includes(c)
            )
          : null

    let remindAtIso: string | undefined
    if (remindAt !== undefined) {
      const d = new Date(remindAt)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'remindAt must be a valid date/time' }, { status: 400 })
      }
      remindAtIso = d.toISOString()
      // Editing the time on a pending reminder clears any previous send
      // marker so the delivery cron will consider it due again.
    }

    // Every column below used to fall back to "keep the current value" via
    // a nested sql`columnName` fragment (e.g.
    // `description = ${description !== undefined ? description : sql\`description\`}`).
    // That's not a whole-clause fragment (the one pattern the Neon
    // serverless driver's docs actually demonstrate, like a full
    // `WHERE ...` or `AND ...` clause) - it's a bare identifier dropped into
    // a single value slot, and the driver doesn't recognize it as SQL
    // there. It gets coerced to its JS object representation instead, so
    // every PATCH (checking a reminder off, dismissing it, editing it)
    // failed with "NeonDbError: invalid input syntax for type timestamp
    // with time zone: "{ parameterizedQuery: {...} }"" - the "keep remind_at
    // as-is" fragment landing in a timestamp column, verbatim. `reminder`
    // (loaded above) already has the current row, so compute the fallback
    // in JS and bind it as a plain value - no nested sql`` involved.
    const updated = await sql`
      UPDATE reminders SET
        title = ${title ?? reminder.title},
        description = ${description !== undefined ? description : reminder.description},
        remind_at = ${remindAtIso ?? reminder.remind_at},
        sent_at = ${remindAtIso !== undefined ? null : reminder.sent_at},
        is_recurring = ${isRecurring !== undefined ? isRecurring : reminder.is_recurring},
        recurrence_rule = ${recurrenceRule !== undefined ? recurrenceRule : reminder.recurrence_rule},
        notify_channels = ${normalizedNotifyChannels !== undefined ? normalizedNotifyChannels : reminder.notify_channels},
        status = ${nextStatus ?? reminder.status},
        updated_at = NOW()
      WHERE id = ${reminderId}
      RETURNING *
    `

    return NextResponse.json({ data: updated[0] })
  } catch (error) {
    console.error('Reminder PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update reminder' }, { status: 500 })
  }
}

// DELETE - permanently remove a reminder
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ reminderId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { reminderId } = await params
    const reminder = await loadReminder(reminderId, user.id)
    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
    }

    await sql`DELETE FROM reminders WHERE id = ${reminderId}`

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Reminder DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete reminder' }, { status: 500 })
  }
}
