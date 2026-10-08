/**
 * Email Service using Resend
 * 
 * Required environment variables:
 * - RESEND_API_KEY: Your Resend API Key
 * - EMAIL_FROM: Default sender email (e.g., notifications@yourdomain.com)
 */

interface EmailPayload {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
}

interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Check if Resend is configured
 */
export function isResendConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY)
}

/**
 * Send email via Resend
 */
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (!isResendConfigured()) {
    console.warn('Resend not configured - Email not sent')
    return { success: false, error: 'Resend not configured' }
  }

  const apiKey = process.env.RESEND_API_KEY!
  // Sender domain must be verified in Resend before emails will actually
  // send. Reads EMAIL_FROM if set (see docstring above), otherwise falls
  // back to the verified domain, mytogethr.com (this used to be hardcoded
  // to nexusifm.com, a domain that was never verified in Resend at all).
  const verifiedFrom = process.env.EMAIL_FROM || 'Togethr <admin@mytogethr.com>'

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: verifiedFrom,
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Resend error:', data)
      return { 
        success: false, 
        error: data.message || 'Failed to send email' 
      }
    }

    return { 
      success: true, 
      messageId: data.id 
    }
  } catch (error) {
    console.error('Email send error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * The address that receives operational alerts about the business itself
 * (new signups, support tickets, cancellations, tier changes) — distinct
 * from any user-facing email, which always goes to that user's own address.
 */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@mytogethr.com'

/**
 * Send an operational alert to the admin address. Failures are logged but
 * never thrown — a notification going out is never allowed to fail the
 * user-facing request (signup, ticket submission, etc.) that triggered it.
 */
export async function notifyAdmin(subject: string, html: string, text?: string): Promise<void> {
  try {
    const result = await sendEmail({ to: ADMIN_EMAIL, subject, html, text })
    if (!result.success) {
      console.error('[admin-notify] failed to send:', subject, result.error)
    }
  } catch (error) {
    console.error('[admin-notify] threw while sending:', subject, error)
  }
}

/**
 * Send email to multiple recipients
 */
export async function sendBulkEmail(
  recipients: string[],
  subject: string,
  html: string,
  text?: string
): Promise<{ sent: number; failed: number }> {
  // Resend supports batch sending up to 100 emails
  const result = await sendEmail({
    to: recipients.slice(0, 100),
    subject,
    html,
    text,
  })

  return {
    sent: result.success ? recipients.length : 0,
    failed: result.success ? 0 : recipients.length,
  }
}

// Email Templates for Togethr
export const EMAIL_TEMPLATES = {
  WELCOME: (name: string) => ({
    subject: 'Welcome to Togethr!',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="width: 60px; height: 60px; background-color: #0d9488; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 24px; font-weight: bold;">S</span>
              </div>
            </div>
            <h1 style="color: #0d9488; font-size: 24px; margin: 0 0 20px; text-align: center;">Welcome to Togethr!</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              Hi ${name},
            </p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              Thank you for joining Togethr! We're excited to help you keep your family connected and safe.
            </p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
              Get started by setting up your family profile and inviting your family members.
            </p>
            <div style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://safelink.app'}/dashboard" 
                 style="display: inline-block; background-color: #0d9488; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                Get Started
              </a>
            </div>
          </div>
          <p style="color: #6b7280; font-size: 12px; text-align: center; margin-top: 20px;">
            Togethr - Keeping Families Connected
          </p>
        </div>
      </body>
      </html>
    `,
    text: `Welcome to Togethr, ${name}! Thank you for joining. Get started by setting up your family profile.`,
  }),

  EVENT_REMINDER: (eventTitle: string, startTime: string, location?: string) => ({
    subject: `Reminder: ${eventTitle}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #0d9488; font-size: 24px; margin: 0 0 20px;">Event Reminder</h1>
            <div style="background-color: #f0fdfa; border-left: 4px solid #0d9488; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
              <h2 style="color: #374151; font-size: 18px; margin: 0 0 10px;">${eventTitle}</h2>
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                <strong>When:</strong> ${startTime}
                ${location ? `<br><strong>Where:</strong> ${location}` : ''}
              </p>
            </div>
            <div style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://safelink.app'}/calendar" 
                 style="display: inline-block; background-color: #0d9488; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                View Event
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Event Reminder: ${eventTitle} at ${startTime}${location ? ` - ${location}` : ''}`,
  }),

  GEOFENCE_ALERT: (childName: string, action: 'arrived' | 'left', placeName: string, time: string) => ({
    subject: `${childName} ${action === 'arrived' ? 'arrived at' : 'left'} ${placeName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #0d9488; font-size: 24px; margin: 0 0 20px;">Location Alert</h1>
            <div style="background-color: ${action === 'arrived' ? '#f0fdfa' : '#fef2f2'}; border-left: 4px solid ${action === 'arrived' ? '#0d9488' : '#ef4444'}; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
              <p style="color: #374151; font-size: 16px; margin: 0;">
                <strong>${childName}</strong> ${action === 'arrived' ? 'arrived at' : 'left'} <strong>${placeName}</strong>
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 10px 0 0;">
                ${time}
              </p>
            </div>
            <div style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://safelink.app'}/location" 
                 style="display: inline-block; background-color: #0d9488; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                View Location
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Togethr Alert: ${childName} ${action === 'arrived' ? 'arrived at' : 'left'} ${placeName} at ${time}`,
  }),

  TASK_REMINDER: (taskTitle: string, dueDate: string, assignedTo: string) => ({
    subject: `Task Reminder: ${taskTitle}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #0d9488; font-size: 24px; margin: 0 0 20px;">Task Reminder</h1>
            <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
              <h2 style="color: #374151; font-size: 18px; margin: 0 0 10px;">${taskTitle}</h2>
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                <strong>Assigned to:</strong> ${assignedTo}<br>
                <strong>Due:</strong> ${dueDate}
              </p>
            </div>
            <div style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://safelink.app'}/tasks" 
                 style="display: inline-block; background-color: #0d9488; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                View Task
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Task Reminder: ${taskTitle} assigned to ${assignedTo} is due ${dueDate}`,
  }),

  TASK_STATUS_CHANGED: (taskTitle: string, newStatus: string, changedBy: string) => ({
    subject: `Task Update: ${taskTitle}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #0d9488; font-size: 24px; margin: 0 0 20px;">Task Update</h1>
            <div style="background-color: #f0fdfa; border-left: 4px solid #0d9488; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
              <h2 style="color: #374151; font-size: 18px; margin: 0 0 10px;">${taskTitle}</h2>
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                <strong>${changedBy}</strong> marked this task as <strong>${newStatus}</strong>.
              </p>
            </div>
            <div style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://safelink.app'}/tasks"
                 style="display: inline-block; background-color: #0d9488; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                View Task
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `${changedBy} marked "${taskTitle}" as ${newStatus}`,
  }),

  PASSWORD_RESET: (resetLink: string) => ({
    subject: 'Reset Your Togethr Password',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #0d9488; font-size: 24px; margin: 0 0 20px; text-align: center;">Reset Your Password</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              We received a request to reset your Togethr password. Click the button below to create a new password.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" 
                 style="display: inline-block; background-color: #0d9488; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                Reset Password
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
              If you didn't request this, you can safely ignore this email. This link expires in 1 hour.
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Reset your Togethr password: ${resetLink}. This link expires in 1 hour.`,
  }),

  FAMILY_INVITE: (inviterName: string, familyName: string, inviteLink: string) => ({
    subject: `${inviterName} invited you to join ${familyName} on Togethr`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="width: 60px; height: 60px; background-color: #0d9488; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 24px; font-weight: bold;">S</span>
              </div>
            </div>
            <h1 style="color: #0d9488; font-size: 24px; margin: 0 0 20px; text-align: center;">You're Invited!</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px; text-align: center;">
              <strong>${inviterName}</strong> has invited you to join the <strong>${familyName}</strong> family on Togethr.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteLink}" 
                 style="display: inline-block; background-color: #0d9488; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                Accept Invitation
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; text-align: center;">
              This invitation expires in 7 days.
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `${inviterName} invited you to join ${familyName} on Togethr. Accept here: ${inviteLink}`,
  }),

  WEEKLY_DIGEST: (
    userName: string,
    familyName: string,
    weekStart: string,
    weekEnd: string,
    events: Array<{ title: string; start_time: string; location?: string }>,
    tasks: { completed: number; pending: number; overdue: number }
  ) => ({
    subject: `Weekly Family Summary - ${familyName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="width: 60px; height: 60px; background-color: #3b4563; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 24px; font-weight: bold;">T</span>
              </div>
            </div>
            <h1 style="color: #3b4563; font-size: 24px; margin: 0 0 10px; text-align: center;">Weekly Summary</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 30px; text-align: center;">${familyName} - ${weekStart} to ${weekEnd}</p>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              Hi ${userName},
            </p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
              Here's your weekly family update from Togethr.
            </p>

            <!-- Tasks Summary -->
            <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h2 style="color: #374151; font-size: 18px; margin: 0 0 15px;">Tasks This Week</h2>
              <div style="display: flex; gap: 20px;">
                <div style="flex: 1; text-align: center;">
                  <div style="font-size: 28px; font-weight: bold; color: #10b981;">${tasks.completed}</div>
                  <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Completed</div>
                </div>
                <div style="flex: 1; text-align: center;">
                  <div style="font-size: 28px; font-weight: bold; color: #f59e0b;">${tasks.pending}</div>
                  <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Pending</div>
                </div>
                <div style="flex: 1; text-align: center;">
                  <div style="font-size: 28px; font-weight: bold; color: #ef4444;">${tasks.overdue}</div>
                  <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Overdue</div>
                </div>
              </div>
            </div>

            <!-- Upcoming Events -->
            <div style="margin-bottom: 30px;">
              <h2 style="color: #374151; font-size: 18px; margin: 0 0 15px;">Upcoming Events (${events.length})</h2>
              ${events.length > 0 ? events.slice(0, 5).map(event => `
                <div style="border-left: 3px solid #3b4563; padding-left: 15px; margin-bottom: 15px;">
                  <div style="font-weight: 600; color: #374151;">${event.title}</div>
                  <div style="font-size: 14px; color: #6b7280;">${new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                  ${event.location ? `<div style="font-size: 14px; color: #6b7280;">${event.location}</div>` : ''}
                </div>
              `).join('') : '<p style="color: #6b7280; font-style: italic;">No upcoming events this week.</p>'}
              ${events.length > 5 ? `<p style="color: #6b7280; font-size: 14px;">+ ${events.length - 5} more events</p>` : ''}
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://togethr.app'}/dashboard" 
                 style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                View Full Dashboard
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 12px; line-height: 1.6; margin: 30px 0 0; text-align: center;">
              You're receiving this because you have weekly digest enabled.<br>
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://togethr.app'}/settings" style="color: #6b7280;">Manage notification preferences</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Weekly Summary for ${familyName} (${weekStart} - ${weekEnd})\n\nHi ${userName},\n\nTasks: ${tasks.completed} completed, ${tasks.pending} pending, ${tasks.overdue} overdue\n\nUpcoming Events: ${events.length}\n${events.slice(0, 5).map(e => `- ${e.title} (${new Date(e.start_time).toLocaleDateString()})`).join('\n')}\n\nView dashboard: ${process.env.NEXT_PUBLIC_APP_URL || 'https://togethr.app'}/dashboard`,
  }),

  // --- Admin operational alerts ---------------------------------------
  // These four go to notifyAdmin()/ADMIN_EMAIL, never to a regular user.

  ADMIN_NEW_SIGNUP: (userEmail: string, userName: string) => ({
    subject: `New signup: ${userEmail}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <h2 style="color: #0d9488;">New user signup</h2>
        <p><strong>Name:</strong> ${userName}</p>
        <p><strong>Email:</strong> ${userEmail}</p>
        <p><strong>When:</strong> ${new Date().toISOString()}</p>
      </div>
    `,
    text: `New user signup: ${userName} <${userEmail}> at ${new Date().toISOString()}`,
  }),

  ADMIN_NEW_TICKET: (ticketId: string, userEmail: string, subject: string, message: string) => ({
    subject: `New support ticket: ${subject}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <h2 style="color: #0d9488;">New support ticket</h2>
        <p><strong>Ticket ID:</strong> ${ticketId}</p>
        <p><strong>From:</strong> ${userEmail}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p style="white-space: pre-wrap; background:#f9fafb; border-radius:8px; padding:12px;">${message}</p>
      </div>
    `,
    text: `New support ticket ${ticketId} from ${userEmail}\nSubject: ${subject}\n\n${message}`,
  }),

  ADMIN_SUBSCRIPTION_CANCELLED: (userEmail: string, familyName: string, previousTier: string) => ({
    subject: `Subscription cancelled: ${familyName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <h2 style="color: #ef4444;">Subscription cancelled</h2>
        <p><strong>Family:</strong> ${familyName}</p>
        <p><strong>Owner email:</strong> ${userEmail}</p>
        <p><strong>Previous tier:</strong> ${previousTier}</p>
        <p><strong>When:</strong> ${new Date().toISOString()}</p>
      </div>
    `,
    text: `Subscription cancelled for ${familyName} (${userEmail}). Previous tier: ${previousTier}.`,
  }),

  ADMIN_TIER_CHANGED: (userEmail: string, familyName: string, previousTier: string, newTier: string) => ({
    subject: `Tier changed: ${familyName} (${previousTier} -> ${newTier})`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <h2 style="color: #0d9488;">Subscription tier changed</h2>
        <p><strong>Family:</strong> ${familyName}</p>
        <p><strong>Owner email:</strong> ${userEmail}</p>
        <p><strong>Previous tier:</strong> ${previousTier}</p>
        <p><strong>New tier:</strong> ${newTier}</p>
        <p><strong>When:</strong> ${new Date().toISOString()}</p>
      </div>
    `,
    text: `Tier changed for ${familyName} (${userEmail}): ${previousTier} -> ${newTier}.`,
  }),
}
