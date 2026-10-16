/**
 * Unified Notification Dispatcher
 * Sends notifications via multiple channels based on user preferences
 */

import { sql } from '@/lib/db'
import { sendSMSMetered, SMS_TEMPLATES, isTwilioConfigured } from './sms'
import { sendEmail, EMAIL_TEMPLATES, isResendConfigured } from './email'
import { sendPushToUser, isFirebaseConfigured } from './push'
import { createNotification } from '../notifications'

export type NotificationChannel = 'in_app' | 'push' | 'email' | 'sms'

export interface NotificationRequest {
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  channels?: NotificationChannel[]
  // Optional overrides
  emailTemplate?: keyof typeof EMAIL_TEMPLATES
  emailData?: Record<string, string>
  smsTemplate?: keyof typeof SMS_TEMPLATES
  smsData?: string[]
}

interface DispatchResult {
  inApp: boolean
  push: { sent: number; failed: number }
  email: boolean
  sms: boolean
  errors: string[]
}

/**
 * Get user's notification preferences
 */
async function getUserNotificationPreferences(userId: string): Promise<{
  email: string | null
  phone: string | null
  channels: {
    inApp: boolean
    push: boolean
    email: boolean
    sms: boolean
  }
}> {
  const user = await sql`
    SELECT email, phone FROM users WHERE id = ${userId}
  `

  // Reads from reminder_settings - the table the Settings page's
  // notification-settings route actually reads and writes - not the
  // never-populated notification_preferences table this used to query
  // (nothing in the app ever inserts a row there, so every lookup against
  // it silently fell back to hardcoded defaults regardless of what the
  // user had toggled). reminder_settings has no in_app_enabled column;
  // in-app notifications are always on, matching the fallback default
  // this function already used.
  const settings = await sql`
    SELECT
      email_enabled,
      sms_enabled,
      push_enabled
    FROM reminder_settings
    WHERE user_id = ${userId}
  `

  const prefs = settings[0] || {
    email_enabled: true,
    sms_enabled: false,
    push_enabled: true,
  }

  return {
    email: user[0]?.email || null,
    phone: user[0]?.phone || null,
    channels: {
      inApp: true,
      push: prefs.push_enabled !== false,
      email: prefs.email_enabled !== false,
      sms: prefs.sms_enabled === true,
    },
  }
}

/**
 * Dispatch notification to all configured channels
 */
export async function dispatchNotification(
  request: NotificationRequest
): Promise<DispatchResult> {
  const result: DispatchResult = {
    inApp: false,
    push: { sent: 0, failed: 0 },
    email: false,
    sms: false,
    errors: [],
  }

  try {
    // Get user preferences
    const prefs = await getUserNotificationPreferences(request.userId)
    
    // Determine which channels to use
    const channels = request.channels || ['in_app', 'push', 'email']

    // 1. In-App Notification (always try)
    if (channels.includes('in_app') && prefs.channels.inApp) {
      try {
        await createNotification({
          userId: request.userId,
          type: request.type as Parameters<typeof createNotification>[0]['type'],
          title: request.title,
          body: request.body,
          data: request.data,
        })
        result.inApp = true
      } catch (error) {
        result.errors.push(`In-app: ${error instanceof Error ? error.message : 'Failed'}`)
      }
    }

    // 2. Push Notification
    if (channels.includes('push') && prefs.channels.push && isFirebaseConfigured()) {
      try {
        const pushResult = await sendPushToUser(request.userId, {
          title: request.title,
          body: request.body,
          data: request.data as Record<string, string>,
        })
        result.push = pushResult
      } catch (error) {
        result.errors.push(`Push: ${error instanceof Error ? error.message : 'Failed'}`)
      }
    }

    // 3. Email Notification
    if (channels.includes('email') && prefs.channels.email && prefs.email && isResendConfigured()) {
      try {
        let emailContent: { subject: string; html: string; text: string }
        
        if (request.emailTemplate && EMAIL_TEMPLATES[request.emailTemplate]) {
          const templateFn = EMAIL_TEMPLATES[request.emailTemplate] as (...args: string[]) => { subject: string; html: string; text: string }
          emailContent = templateFn(...(request.smsData || []))
        } else {
          // Default email format
          emailContent = {
            subject: request.title,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #0d9488;">${request.title}</h2>
                <p>${request.body}</p>
              </div>
            `,
            text: `${request.title}\n\n${request.body}`,
          }
        }
        
        const emailResult = await sendEmail({
          to: prefs.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        })
        result.email = emailResult.success
        if (!emailResult.success && emailResult.error) {
          result.errors.push(`Email: ${emailResult.error}`)
        }
      } catch (error) {
        result.errors.push(`Email: ${error instanceof Error ? error.message : 'Failed'}`)
      }
    }

    // 4. SMS Notification
    if (channels.includes('sms') && prefs.channels.sms && prefs.phone && isTwilioConfigured()) {
      try {
        let smsBody: string
        
        if (request.smsTemplate && SMS_TEMPLATES[request.smsTemplate]) {
          const templateFn = SMS_TEMPLATES[request.smsTemplate] as (...args: string[]) => string
          smsBody = templateFn(...(request.smsData || []))
        } else {
          // Default SMS format (truncate to 160 chars)
          smsBody = `Togethr: ${request.title} - ${request.body}`.substring(0, 160)
        }
        
        // Counts against the family's monthly SMS quota (familyId from the
        // notification data, else the recipient's family).
        const smsResult = await sendSMSMetered({
          to: prefs.phone,
          body: smsBody,
          familyId: typeof request.data?.familyId === 'string' ? request.data.familyId : null,
          userId: request.userId,
        })
        result.sms = smsResult.success
        if (!smsResult.success && smsResult.error) {
          result.errors.push(`SMS: ${smsResult.error}`)
        }
      } catch (error) {
        result.errors.push(`SMS: ${error instanceof Error ? error.message : 'Failed'}`)
      }
    }

    return result
  } catch (error) {
    console.error('Notification dispatch error:', error)
    result.errors.push(`Dispatch: ${error instanceof Error ? error.message : 'Failed'}`)
    return result
  }
}

/**
 * Send notification to multiple users
 */
export async function dispatchNotificationToUsers(
  userIds: string[],
  notification: Omit<NotificationRequest, 'userId'>
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  for (const userId of userIds) {
    const result = await dispatchNotification({ ...notification, userId })
    if (result.inApp || result.push.sent > 0 || result.email || result.sms) {
      success++
    } else {
      failed++
    }
  }

  return { success, failed }
}

/**
 * Send notification to all family members
 */
export async function dispatchNotificationToFamily(
  familyId: string,
  notification: Omit<NotificationRequest, 'userId'>,
  excludeUserId?: string
): Promise<{ success: number; failed: number }> {
  const members = await sql`
    SELECT user_id FROM family_members
    WHERE family_id = ${familyId}
      AND is_active = true
      ${excludeUserId ? sql`AND user_id != ${excludeUserId}` : sql``}
  `

  const userIds = members.map(m => m.user_id)
  return dispatchNotificationToUsers(userIds, notification)
}

/**
 * Send notification to family parents only
 */
export async function dispatchNotificationToParents(
  familyId: string,
  notification: Omit<NotificationRequest, 'userId'>
): Promise<{ success: number; failed: number }> {
  const parents = await sql`
    SELECT user_id FROM family_members
    WHERE family_id = ${familyId}
      AND is_active = true
      AND role IN ('PARENT', 'GUARDIAN')
  `

  const userIds = parents.map(m => m.user_id)
  return dispatchNotificationToUsers(userIds, notification)
}

/**
 * Get notification service status
 */
export function getNotificationServicesStatus(): {
  sms: boolean
  email: boolean
  push: boolean
} {
  return {
    sms: isTwilioConfigured(),
    email: isResendConfigured(),
    push: isFirebaseConfigured(),
  }
}
