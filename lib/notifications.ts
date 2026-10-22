import { sql, type Row } from '@/lib/db'
import { sendPushToUser, isFirebaseConfigured, notificationDedupeKey } from "@/lib/services/push"
import { notificationHref } from "@/lib/notification-link"
import { sendEmail, isResendConfigured, EMAIL_TEMPLATES } from "@/lib/services/email"
import { sendSMSMetered, isTwilioConfigured } from "@/lib/services/sms"

// SMS for in-app notifications. Goes through the metered sender so every text
// counts against the family's monthly SMS quota (over quota it is skipped and
// push/email carry the notification). Never throws.
export async function sendSmsNotification(
  phoneNumber: string,
  message: string,
  meter: { familyId?: string | null; userId?: string | null } = {}
): Promise<{ success: boolean; error?: string }> {
  // If Twilio is not configured, skip SMS without blocking the flow.
  if (!isTwilioConfigured()) {
    console.log('[SMS] Twilio not configured, skipping SMS notification')
    return { success: true }
  }
  const result = await sendSMSMetered({ to: phoneNumber, body: message, familyId: meter.familyId, userId: meter.userId })
  return { success: result.success, error: result.error }
}

export type NotificationType =
  | 'REMINDER'
  | 'EVENT_REMINDER'
  | 'EVENT_INVITATION'
  | 'EVENT_UPDATE'
  | 'EVENT_APPROVAL_REQUEST'
  | 'EVENT_APPROVED'
  | 'EVENT_REJECTED'
  | 'EVENT_CREATED'
  | 'LOCATION_ALERT'
  | 'GEOFENCE_ALERT'
  | 'FAMILY_INVITATION'
  | 'FAMILY_INVITE'
  | 'TASK_ASSIGNED'
  | 'TASK_COMPLETED'
  | 'TASK_OVERDUE'
  | 'TASK_COMMENT'
  | 'APPROVAL_REQUEST'
  | 'APPROVAL_RESPONSE'
  | 'SUBSCRIPTION_ALERT'
  | 'SYSTEM'

// Mirrors NotificationChannel in lib/services/notification-dispatcher.ts
// (duplicated as a plain string union, not imported, since that module
// imports createNotification FROM this file - importing the type back
// would be a circular import for no benefit, as string-literal unions are
// structurally compatible either way).
export type NotificationChannel = 'in_app' | 'push' | 'email' | 'sms'

type NotificationData = {
  userId: string
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  sendSms?: boolean // If true and user has phone, also send SMS
  sendEmail?: boolean // If true and user has email notifications enabled, also send an email
  // Per-item channel override (e.g. the notify-channels picker on a task or
  // event creation form). When provided, it takes priority over sendSms/
  // sendEmail and over the always-attempt behavior of in_app/push below -
  // a channel not listed here is skipped entirely for this call, even if
  // the recipient's own settings would otherwise allow it. When omitted
  // (the common case - every pre-existing call site), behavior is
  // unchanged: in_app always written, push always attempted (subject to
  // the recipient's push_enabled), sms/email gated by the flags above.
  channels?: NotificationChannel[]
  // When true (a parent assigning something to a child), push/email/SMS go out
  // even if the child's own channel toggles are off, as long as the child has
  // a push device / email / phone on file.
  force?: boolean
}

export async function createNotification({
  userId,
  type,
  title,
  body,
  data = {},
  sendSms = false,
  sendEmail: sendEmailFlag = false,
  channels,
  force = false
}: NotificationData): Promise<{ success: boolean; notificationId?: string; error?: string }> {
  try {
    const notificationId = crypto.randomUUID()
    const wantsInApp = !channels || channels.includes('in_app')
    const wantsPush = !channels || channels.includes('push')
    const wantsSms = channels ? channels.includes('sms') : sendSms
    const wantsEmail = channels ? channels.includes('email') : sendEmailFlag

    // One message per channel per event: the same notification (recipient,
    // type, title, body and data) made again within a minute - a double call,
    // a retried request - is not sent again on any channel. Crons keep their
    // own exactly-once markers (event reminders: the notifications row;
    // process-reminders: sent_at).
    const dataJson = JSON.stringify(data)
    const recent = await sql`
      SELECT id FROM notifications
      WHERE user_id = ${userId} AND type = ${type} AND title = ${title} AND body = ${body}
        AND data = ${dataJson}::jsonb AND created_at > NOW() - INTERVAL '60 seconds'
      LIMIT 1
    `
    if (recent.length > 0) {
      return { success: true, notificationId: recent[0].id as string }
    }

    console.log('[Notification] Creating notification:', { userId, type, title })

    if (wantsInApp) {
      await sql`
        INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at)
        VALUES (
          ${notificationId},
          ${userId},
          ${type},
          ${title},
          ${body},
          ${JSON.stringify(data)}::jsonb,
          false,
          NOW()
        )
      `
      console.log('[Notification] Created successfully:', notificationId)
    }

    // Every in-app notification also gets a best-effort real push
    // notification, so the two systems this app has accumulated
    // (this file's DB+SMS path and lib/services/notification-dispatcher.ts's
    // FCM path) stop diverging. This never blocks or throws back to the
    // caller: a user with no active push subscription just gets sent:0 from
    // sendPushToUser, and any error is logged, not propagated, so a stale
    // token or a transient push-provider issue can't break task/event
    // notifications that already worked before push existed.
    //
    // Gated on reminder_settings.push_enabled - the same column the Settings
    // page toggle writes to - so a user who turned push off there doesn't
    // get a system-level notification anyway (this used to fire
    // unconditionally for every notification type, ignoring the toggle).
    if (wantsPush && isFirebaseConfigured()) {
      try {
        const pushPrefs = await sql`
          SELECT push_enabled FROM reminder_settings WHERE user_id = ${userId}
        `
        const pushEnabled = force || pushPrefs.length === 0 || pushPrefs[0].push_enabled

        if (pushEnabled) {
          // Same destination as clicking it in the app (lib/notification-link.ts).
          const clickAction = notificationHref(type, data) ?? '/'

          const pushData: Record<string, string> = { type }
          for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null) {
              pushData[key] = String(value)
            }
          }
          // Same notification = same key: the push Topic (a queued copy is
          // replaced) and the service worker's tag (a copy isn't shown twice).
          const dedupeKey = notificationDedupeKey({ userId, type, title, body, data })
          pushData.dedupeKey = dedupeKey
          pushData.notificationId = notificationId

          await sendPushToUser(userId, { title, body, data: pushData, clickAction, topic: dedupeKey })
        }
      } catch (pushError) {
        console.error('[Notification] Push send failed (non-fatal):', pushError)
      }
    }

    // Check if user has SMS enabled and send if requested
    if (wantsSms) {
      const userSmsPrefs = await sql`
        SELECT u.phone, rs.sms_enabled
        FROM users u
        LEFT JOIN reminder_settings rs ON u.id = rs.user_id
        WHERE u.id = ${userId}
      `
      if (userSmsPrefs.length > 0 && userSmsPrefs[0].phone && (force || userSmsPrefs[0].sms_enabled)) {
        await sendSmsNotification(userSmsPrefs[0].phone, `Togethr: ${title} - ${body}`, {
          familyId: typeof data.familyId === 'string' ? data.familyId : null,
          userId,
        })
      }
    }

    // Check if user has email notifications enabled and send if requested.
    // Gated on the same reminder_settings.email_enabled column used
    // elsewhere in the app, mirroring the sms_enabled gate above. This is
    // the mechanism behind task-status-change emails: previously no task
    // lifecycle event (assign, complete, approve, reject, etc.) ever sent
    // an email at all - createNotification only wrote an in-app row and,
    // optionally, an SMS.
    if (wantsEmail && isResendConfigured()) {
      try {
        // users has no "name" column (only first_name/last_name), and it's
        // not even used below - selecting it just made this query throw
        // "column \"name\" does not exist" every time, silently (caught
        // below), so these emails never actually sent.
        const userEmailPrefs = await sql`
          SELECT u.email, rs.email_enabled
          FROM users u
          LEFT JOIN reminder_settings rs ON u.id = rs.user_id
          WHERE u.id = ${userId}
        `
        if (userEmailPrefs.length > 0 && userEmailPrefs[0].email && (force || userEmailPrefs[0].email_enabled)) {
          const taskTitle = typeof data.taskTitle === 'string' ? data.taskTitle : title
          const newStatus = typeof data.newStatus === 'string' ? data.newStatus : null
          const changedBy = typeof data.changedBy === 'string' ? data.changedBy : 'Someone'

          const template = newStatus
            ? EMAIL_TEMPLATES.TASK_STATUS_CHANGED(taskTitle, newStatus, changedBy)
            : { subject: title, html: `<p>${body}</p>`, text: body }

          await sendEmail({ to: userEmailPrefs[0].email, ...template })
        }
      } catch (emailError) {
        console.error('[Notification] Email send failed (non-fatal):', emailError)
      }
    }

    return { success: true, notificationId }
  } catch (error) {
    console.error('Failed to create notification:', error)
    return { success: false, error: 'Failed to create notification' }
  }
}

export async function notifyTaskAssigned(
  userId: string,
  taskTitle: string,
  taskId: string,
  familyId: string,
  assignedBy: string,
  channels?: NotificationChannel[] // from the task's notify_channels column, if the creator picked any
): Promise<void> {
  await createNotification({
    userId,
    type: 'TASK_ASSIGNED',
    title: 'New Task Assigned',
    body: `${assignedBy} assigned you a task: "${taskTitle}"`,
    data: { taskId, familyId },
    sendSms: true, // Will check user preferences before sending
    sendEmail: true, // Will check user preferences before sending
    channels
  })
}

export async function notifyTaskCompleted(
  userId: string,
  taskTitle: string,
  taskId: string,
  familyId: string,
  completedBy: string
): Promise<void> {
  await createNotification({
    userId,
    type: 'TASK_COMPLETED',
    title: 'Task Completed',
    body: `${completedBy} completed the task: "${taskTitle}"`,
    data: { taskId, familyId },
    sendSms: true // Will check user preferences before sending
  })
}

/**
 * Notifies everyone "associated with" a task whenever a comment is posted
 * or edited on it: the assigned user, plus every active parent/guardian in
 * the family (so a parent who isn't the assignee still hears about it),
 * excluding whoever wrote the comment. This mirrors the recipient logic
 * already used for task status-change notifications in
 * app/api/tasks/[taskId]/route.ts, just scoped to comments. Each recipient
 * gets both an in-app notification and, if they have SMS enabled, a text
 * (createNotification checks that preference before sending).
 */
export async function notifyTaskComment({
  taskId,
  familyId,
  taskTitle,
  assignedToId,
  commenterId,
  commenterName,
  commentMessage,
  action = 'added',
}: {
  taskId: string
  familyId: string
  taskTitle: string
  assignedToId: string | null
  commenterId: string
  commenterName: string
  commentMessage: string
  action?: 'added' | 'updated'
}): Promise<void> {
  const recipientIds = new Set<string>()

  if (assignedToId && assignedToId !== commenterId) {
    recipientIds.add(assignedToId)
  }

  const guardians = await sql`
    SELECT user_id FROM family_members
    WHERE family_id = ${familyId}
      AND is_active = true
      AND role IN ('PARENT', 'GUARDIAN')
      AND user_id IS NOT NULL
  `
  for (const guardian of guardians) {
    if (guardian.user_id !== commenterId) {
      recipientIds.add(guardian.user_id)
    }
  }

  const excerpt = commentMessage.length > 120
    ? `${commentMessage.slice(0, 117)}...`
    : commentMessage

  const title = action === 'updated'
    ? `Comment updated on "${taskTitle}"`
    : `New comment on "${taskTitle}"`
  const verb = action === 'updated' ? 'edited a comment' : 'commented'

  for (const userId of recipientIds) {
    await createNotification({
      userId,
      type: 'TASK_COMMENT',
      title,
      body: `${commenterName} ${verb}: "${excerpt}"`,
      data: { taskId, familyId },
      sendSms: true // Will check the recipient's SMS preference before sending
    })
  }
}

export async function notifyFamilyAboutEvent(
  familyId: string,
  eventTitle: string,
  eventId: string,
  creatorName: string,
  excludeUserId?: string,
  channels?: NotificationChannel[], // from the event's notify_channels column, if the creator picked any
  skipUserIds: string[] = [] // people who get their own (forced) notification instead
): Promise<void> {
  // Notify ALL active family members with linked accounts - except guests,
  // who only hear about events they are invited to (via their own invitation).
  const members = await sql`
    SELECT fm.user_id
    FROM family_members fm
    WHERE fm.family_id = ${familyId}
      AND fm.is_active = true
      AND fm.user_id IS NOT NULL
      AND fm.role <> 'GUEST'
      AND (${excludeUserId ?? null}::text IS NULL OR fm.user_id <> ${excludeUserId ?? null})
  `

  for (const member of members) {
    if (skipUserIds.includes(member.user_id)) continue
    // One call per member, one message per channel: createNotification sends
    // the text too (when the creator picked SMS or picked nothing), gated by
    // the member's sms_enabled and the family's plan/quota. (A separate SMS
    // send here used to text everyone a second time, ignoring sms_enabled.)
    await createNotification({
      userId: member.user_id,
      type: 'EVENT_CREATED',
      title: 'New Family Event',
      body: `${creatorName} created a new event: "${eventTitle}"`,
      data: { eventId, familyId },
      sendEmail: true, // Will check user preferences before sending
      sendSms: true, // Will check sms_enabled, phone and quota before sending
      channels
    })
  }
}

export async function checkAndNotifyOverdueTasks(): Promise<{ notified: number }> {
  const overdueTasks = await sql`
    SELECT t.id, t.title, t.assigned_to_id, t.child_profile_id, t.family_id,
           cp.family_member_id as child_member_id
    FROM tasks t
    LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
    WHERE t.status IN ('pending', 'in_progress', 'PENDING', 'IN_PROGRESS')
      AND (t.assignment_status IS NULL OR t.assignment_status = 'ACCEPTED')
      AND t.due_date < NOW()
      AND t.due_date > NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n 
        WHERE n.data->>'taskId' = t.id 
          AND n.type = 'TASK_OVERDUE'
          AND n.created_at > NOW() - INTERVAL '24 hours'
      )
  `
  
  let notified = 0
  
  for (const task of overdueTasks) {
    const usersToNotify: string[] = []
    
    if (task.assigned_to_id) {
      usersToNotify.push(task.assigned_to_id)
    }
    
    if (task.child_member_id) {
      const childMember = await sql`
        SELECT user_id FROM family_members WHERE id = ${task.child_member_id}
      `
      if (childMember.length > 0 && childMember[0].user_id) {
        usersToNotify.push(childMember[0].user_id)
      }
    }
    
    const parents = await sql`
      SELECT fm.user_id
      FROM family_members fm
      WHERE fm.family_id = ${task.family_id}
        AND fm.is_active = true
        AND fm.role IN ('PARENT', 'GUARDIAN')
    `
    
    for (const parent of parents) {
      if (!usersToNotify.includes(parent.user_id)) {
        usersToNotify.push(parent.user_id)
      }
    }
    
    for (const userId of usersToNotify) {
      await createNotification({
        userId,
        type: 'TASK_OVERDUE',
        title: 'Task Overdue',
        body: `Task "${task.title}" is overdue and needs attention`,
        data: { 
          taskId: task.id, 
          familyId: task.family_id,
          isOverdue: true,
          dueDate: task.due_date
        }
      })
      notified++
    }
  }
  
  return { notified }
}

export async function checkAndNotifyEventReminders(): Promise<{ notified: number }> {
  const events = await sql`
    SELECT e.id, e.title, e.start_time, e.location, e.reminder_minutes,
           e.created_by_id, c.family_id
    FROM events e
    JOIN calendars c ON e.calendar_id = c.id
    WHERE FALSE -- event reminders are sent by /api/cron/event-reminders (reminder_minutes is INTEGER[])
      AND e.reminder_minutes IS NOT NULL
      AND e.start_time > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM notifications n 
        WHERE n.data->>'eventId' = e.id 
          AND n.type = 'EVENT_REMINDER'
          AND n.data->>'reminderMinutes' IS NOT NULL
          AND n.created_at > NOW() - INTERVAL '1 hour'
      )
  `
  
  let notified = 0
  
  for (const event of events) {
    const participants = await sql`
      SELECT ep.user_id
      FROM event_participants ep
      WHERE ep.event_id = ${event.id}
        AND ep.status != 'DECLINED'
        AND ep.user_id IS NOT NULL
    `
    
    const members = await sql`
      SELECT fm.user_id
      FROM family_members fm
      WHERE fm.family_id = ${event.family_id}
        AND fm.is_active = true
    `
    
    const usersToNotify = new Set<string>()
    participants.forEach((p) => usersToNotify.add(p.user_id as string))
    members.forEach((m) => usersToNotify.add(m.user_id as string))
    
    const startTime = new Date(event.start_time)
    const timeText = startTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
    
    for (const userId of usersToNotify) {
      await createNotification({
        userId,
        type: 'EVENT_REMINDER',
        title: `Reminder: ${event.title}`,
        body: `"${event.title}" starts at ${timeText}${event.location ? ` at ${event.location}` : ''}`,
        data: { 
          eventId: event.id, 
          familyId: event.family_id,
          reminderMinutes: event.reminder_minutes
        }
      })
      notified++
    }
  }
  
  return { notified }
}

export async function checkAndNotifyUpcomingDueDates(): Promise<{ 
  tasksNotified: number
  eventsNotified: number 
}> {
  let tasksNotified = 0
  let eventsNotified = 0
  
  // Tasks due in next 48 hours
  const upcomingTasks = await sql`
    SELECT t.id, t.title, t.due_date, t.assigned_to_id, t.child_profile_id, 
           t.family_id, t.created_by_id, t.priority,
           cp.family_member_id as child_member_id
    FROM tasks t
    LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
    WHERE t.status IN ('pending', 'in_progress', 'on_hold', 'PENDING', 'IN_PROGRESS', 'ON_HOLD')
      AND (t.assignment_status IS NULL OR t.assignment_status = 'ACCEPTED')
      AND t.due_date >= NOW()
      AND t.due_date <= NOW() + INTERVAL '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n 
        WHERE n.data->>'taskId' = t.id 
          AND n.type = 'TASK_ASSIGNED'
          AND (n.data->>'reminder48h')::boolean = true
          AND n.created_at > NOW() - INTERVAL '48 hours'
      )
  `
  
  for (const task of upcomingTasks) {
    const dueDate = new Date(task.due_date)
    const now = new Date()
    const hoursUntilDue = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60))
    
    const usersToNotify: string[] = []
    
    if (task.assigned_to_id) {
      usersToNotify.push(task.assigned_to_id)
    }
    
    if (task.child_profile_id && task.child_member_id) {
      const childMember = await sql`
        SELECT user_id FROM family_members WHERE id = ${task.child_member_id}
      `
      if (childMember.length > 0 && childMember[0].user_id) {
        usersToNotify.push(childMember[0].user_id)
      }
    }
    
    if (task.created_by_id && !usersToNotify.includes(task.created_by_id)) {
      usersToNotify.push(task.created_by_id)
    }
    
    const parents = await sql`
      SELECT fm.user_id
      FROM family_members fm
      WHERE fm.family_id = ${task.family_id}
        AND fm.is_active = true
        AND fm.role IN ('PARENT', 'GUARDIAN')
    `
    
    for (const parent of parents) {
      if (!usersToNotify.includes(parent.user_id)) {
        usersToNotify.push(parent.user_id)
      }
    }
    
    const timeText = hoursUntilDue <= 1 
      ? 'in less than an hour' 
      : hoursUntilDue < 24 
        ? `in ${hoursUntilDue} hours`
        : `in ${Math.floor(hoursUntilDue / 24)} day${Math.floor(hoursUntilDue / 24) > 1 ? 's' : ''}`
    
    for (const userId of usersToNotify) {
      await createNotification({
        userId,
        type: 'TASK_ASSIGNED',
        title: `Task Due Soon: ${task.title}`,
        body: `Task "${task.title}" is due ${timeText}${task.priority === 'high' ? ' (High Priority)' : ''}`,
        data: { 
          taskId: task.id, 
          familyId: task.family_id,
          dueDate: task.due_date,
          reminder48h: true
        }
      })
      tasksNotified++
    }
  }
  
  // Events in next 48 hours
  const upcomingEvents = await sql`
    SELECT e.id, e.title, e.start_time, e.end_time, e.location, e.is_all_day,
           e.created_by_id, e.visibility, c.family_id
    FROM events e
    JOIN calendars c ON e.calendar_id = c.id
    WHERE e.status IN ('APPROVED')
      AND e.start_time >= NOW()
      AND e.start_time <= NOW() + INTERVAL '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.data->>'eventId' = e.id
          AND n.type = 'EVENT_REMINDER'
          AND (n.data->>'reminder48h')::boolean = true
          AND n.created_at > NOW() - INTERVAL '48 hours'
      )
  `

  for (const event of upcomingEvents) {
    const startTime = new Date(event.start_time)
    const now = new Date()
    const hoursUntilEvent = Math.floor((startTime.getTime() - now.getTime()) / (1000 * 60 * 60))

    // Whole family (not guests) only for FAMILY events; PRIVATE goes to the
    // creator alone and SELECTED_MEMBERS to the creator plus participants.
    const members = !event.visibility || event.visibility === 'FAMILY'
      ? await sql`
          SELECT fm.user_id
          FROM family_members fm
          WHERE fm.family_id = ${event.family_id}
            AND fm.is_active = true
            AND fm.role != 'GUEST'
            AND fm.user_id IS NOT NULL
        `
      : [{ user_id: event.created_by_id }]

    const participants = event.visibility === 'PRIVATE' ? [] : await sql`
      SELECT ep.user_id
      FROM event_participants ep
      WHERE ep.event_id = ${event.id}
        AND ep.status != 'DECLINED'
        AND ep.user_id IS NOT NULL
    `
    
    const usersToNotify = new Set<string>()
    members.forEach((m) => usersToNotify.add(m.user_id as string))
    participants.forEach((p) => usersToNotify.add(p.user_id as string))
    
    const timeText = hoursUntilEvent <= 1 
      ? 'in less than an hour' 
      : hoursUntilEvent < 24 
        ? `in ${hoursUntilEvent} hours`
        : hoursUntilEvent < 36
          ? 'tomorrow'
          : 'in 2 days'
    
    for (const userId of usersToNotify) {
      await createNotification({
        userId,
        type: 'EVENT_REMINDER',
        title: `Upcoming Event: ${event.title}`,
        body: `"${event.title}" starts ${timeText}${event.location ? ` at ${event.location}` : ''}`,
        data: { 
          eventId: event.id, 
          familyId: event.family_id,
          startTime: event.start_time,
          reminder48h: true
        }
      })
      eventsNotified++
    }
  }
  
  return { tasksNotified, eventsNotified }
}
