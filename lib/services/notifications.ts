import { sql } from '@/lib/db'

// Notification types matching DB enum
const NotificationType = {
  EVENT_REMINDER: 'EVENT_REMINDER',
  EVENT_INVITATION: 'EVENT_INVITATION',
  EVENT_UPDATE: 'EVENT_UPDATE',
  EVENT_APPROVAL_REQUEST: 'EVENT_APPROVAL_REQUEST',
  EVENT_APPROVED: 'EVENT_APPROVED',
  EVENT_REJECTED: 'EVENT_REJECTED',
  LOCATION_ALERT: 'LOCATION_ALERT',
  GEOFENCE_ALERT: 'GEOFENCE_ALERT',
  FAMILY_INVITATION: 'FAMILY_INVITATION',
  SUBSCRIPTION_ALERT: 'SUBSCRIPTION_ALERT',
  SYSTEM: 'SYSTEM',
  // Extended types for templates (mapped to closest DB enum)
  EVENT_REQUEST_CREATED: 'EVENT_APPROVAL_REQUEST',
  EVENT_REQUEST_APPROVED: 'EVENT_APPROVED',
  EVENT_REQUEST_REJECTED: 'EVENT_REJECTED',
  EVENT_UPDATED: 'EVENT_UPDATE',
  GEOFENCE_ARRIVAL: 'GEOFENCE_ALERT',
  GEOFENCE_DEPARTURE: 'GEOFENCE_ALERT',
  SUBSCRIPTION_STATUS_CHANGED: 'SUBSCRIPTION_ALERT',
} as const

export interface NotificationPayload {
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  familyId?: string
  eventId?: string
}

export interface PushToken {
  userId: string
  token: string
  platform: 'ios' | 'android' | 'web'
}

/**
 * Create an in-app notification
 */
export async function createNotification(payload: NotificationPayload): Promise<string> {
  // Store familyId and eventId in the data JSON since columns don't exist
  const dataWithContext = {
    ...payload.data,
    ...(payload.familyId && { familyId: payload.familyId }),
    ...(payload.eventId && { eventId: payload.eventId }),
  }
  
  const result = await sql`
    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (
      ${payload.userId},
      ${payload.type},
      ${payload.title},
      ${payload.body},
      ${JSON.stringify(dataWithContext)}
    )
    RETURNING id
  `
  
  return result[0].id
}

/**
 * Get user notifications
 */
export async function getUserNotifications(
  userId: string,
  options: { limit?: number; offset?: number; unreadOnly?: boolean } = {}
): Promise<{
  notifications: Array<{
    id: string
    type: string
    title: string
    body: string
    data: Record<string, unknown>
    read: boolean
    createdAt: Date
  }>
  total: number
  unreadCount: number
}> {
  const { limit = 20, offset = 0, unreadOnly = false } = options
  
  const whereClause = unreadOnly ? sql`AND is_read = false` : sql``
  
  const notifications = await sql`
    SELECT id, type, title, body, data, is_read, created_at
    FROM notifications
    WHERE user_id = ${userId} ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  
  const countResult = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_read = false) as unread_count
    FROM notifications
    WHERE user_id = ${userId}
  `
  
  return {
    notifications: notifications.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data || {},
      read: n.is_read,
      createdAt: n.created_at,
    })),
    total: parseInt(countResult[0].total, 10),
    unreadCount: parseInt(countResult[0].unread_count, 10),
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationRead(notificationId: string, userId: string): Promise<boolean> {
  const result = await sql`
    UPDATE notifications
    SET is_read = true, read_at = NOW()
    WHERE id = ${notificationId} AND user_id = ${userId}
    RETURNING id
  `
  
  return result.length > 0
}

/**
 * Mark all notifications as read
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await sql`
    UPDATE notifications
    SET is_read = true, read_at = NOW()
    WHERE user_id = ${userId} AND is_read = false
    RETURNING id
  `
  
  return result.length
}

/**
 * Delete old notifications
 */
export async function cleanupOldNotifications(daysOld: number = 30): Promise<number> {
  const result = await sql`
    DELETE FROM notifications
    WHERE created_at < NOW() - INTERVAL '${daysOld} days'
    RETURNING id
  `
  
  return result.length
}

// Notification templates
const NOTIFICATION_TEMPLATES = {
  [NotificationType.EVENT_REMINDER]: (data: { eventTitle: string; startTime: string }) => ({
    title: 'Event Reminder',
    body: `"${data.eventTitle}" starts at ${data.startTime}`,
  }),
  
  [NotificationType.EVENT_REQUEST_CREATED]: (data: { childName: string; eventTitle: string }) => ({
    title: 'New Event Request',
    body: `${data.childName} requested to create "${data.eventTitle}"`,
  }),
  
  [NotificationType.EVENT_REQUEST_APPROVED]: (data: { eventTitle: string }) => ({
    title: 'Event Approved',
    body: `Your request for "${data.eventTitle}" was approved`,
  }),
  
  [NotificationType.EVENT_REQUEST_REJECTED]: (data: { eventTitle: string; reason?: string }) => ({
    title: 'Event Request Declined',
    body: data.reason 
      ? `Your request for "${data.eventTitle}" was declined: ${data.reason}`
      : `Your request for "${data.eventTitle}" was declined`,
  }),
  
  [NotificationType.EVENT_UPDATED]: (data: { eventTitle: string; updatedBy: string }) => ({
    title: 'Event Updated',
    body: `"${data.eventTitle}" was updated by ${data.updatedBy}`,
  }),
  
  // GEOFENCE_ARRIVAL and GEOFENCE_DEPARTURE are both 'GEOFENCE_ALERT', so one
  // template (two keys was a duplicate: departure replaced arrival).
  [NotificationType.GEOFENCE_ARRIVAL]: (data: { childName: string; placeName: string; departed?: boolean }) => ({
    title: data.departed ? 'Departure Alert' : 'Arrival Alert',
    body: data.departed ? `${data.childName} left ${data.placeName}` : `${data.childName} arrived at ${data.placeName}`,
  }),
  
  [NotificationType.SUBSCRIPTION_STATUS_CHANGED]: (data: { newStatus: string; tier?: string }) => ({
    title: 'Subscription Update',
    body: data.tier 
      ? `Your subscription is now ${data.newStatus} (${data.tier})`
      : `Your subscription status changed to ${data.newStatus}`,
  }),
}

/**
 * Send notification using template
 */
export async function sendTemplateNotification(
  type: string,
  userId: string,
  data: Record<string, unknown>,
  options: { familyId?: string; eventId?: string } = {}
): Promise<string> {
  const template = NOTIFICATION_TEMPLATES[type as keyof typeof NOTIFICATION_TEMPLATES]
  
  if (!template) {
    throw new Error(`Unknown notification type: ${type}`)
  }
  
  const { title, body } = template(data as never)
  
  const notificationId = await createNotification({
    userId,
    type,
    title,
    body,
    data,
    familyId: options.familyId,
    eventId: options.eventId,
  })
  
  // In production, also send push notification here
  await sendPushNotification(userId, { title, body, data })
  
  return notificationId
}

/**
 * Send push notification (abstraction - actual implementation requires push service)
 */
export async function sendPushNotification(
  userId: string,
  payload: { title: string; body: string; data?: Record<string, unknown> }
): Promise<boolean> {
  // This is an abstraction - actual implementation would:
  // 1. Get user's push tokens from database
  // 2. Send via FCM (Firebase), APNs, or web push
  
  console.log('[v0] Push notification would be sent:', { userId, ...payload })
  
  // Return true to indicate abstraction is ready
  return true
}

/**
 * Register push token
 */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android' | 'web'
): Promise<void> {
  // Store push token - in production, this would go to a push_tokens table
  console.log('[v0] Push token registered:', { userId, platform, token: token.substring(0, 20) + '...' })
}

/**
 * Notify family members about an event
 */
export async function notifyFamilyMembers(
  familyId: string,
  excludeUserId: string,
  type: string,
  data: Record<string, unknown>,
  eventId?: string
): Promise<void> {
  // Get all family members except the excluded user
  const members = await sql`
    SELECT u.id
    FROM family_members fm
    JOIN users u ON fm.user_id = u.id
    WHERE fm.family_id = ${familyId}
      AND fm.user_id != ${excludeUserId}
      AND fm.is_active = true
  `
  
  // Send notification to each member
  for (const member of members) {
    await sendTemplateNotification(type, member.id, data, { familyId, eventId })
  }
}

/**
 * Notify parents in a family
 */
export async function notifyParents(
  familyId: string,
  type: string,
  data: Record<string, unknown>,
  eventId?: string
): Promise<void> {
  const parents = await sql`
    SELECT u.id
    FROM family_members fm
    JOIN users u ON fm.user_id = u.id
    WHERE fm.family_id = ${familyId}
      AND fm.role = 'PARENT'
      AND fm.is_active = true
  `
  
  for (const parent of parents) {
    await sendTemplateNotification(type, parent.id, data, { familyId, eventId })
  }
}

/**
 * Schedule event reminder
 */
export async function scheduleEventReminder(
  eventId: string,
  userId: string,
  eventTitle: string,
  startTime: Date,
  reminderMinutes: number
): Promise<void> {
  // In production, this would integrate with a job scheduler (e.g., Vercel Cron, Bull, etc.)
  const reminderTime = new Date(startTime.getTime() - reminderMinutes * 60 * 1000)
  
  console.log('[v0] Event reminder scheduled:', {
    eventId,
    userId,
    eventTitle,
    reminderTime: reminderTime.toISOString(),
  })
  
  // Note: reminder_settings table has user_id unique constraint, not event-specific
  // In production, you'd have a separate event_reminders table
  // For now, we'll just log the reminder setup
  console.log('[v0] Reminder would be stored for event:', eventId, 'user:', userId)
}
