import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { sendPushToUser } from "@/lib/services/push"
import { sendEmail, isResendConfigured } from "@/lib/services/email"
import { sendSMS, isTwilioConfigured } from "@/lib/services/sms"
import { isQuietNow } from "@/lib/quiet-hours"

// Delivers standalone reminders (lib: see app/api/reminders) - the
// "just remind me of a thing" feature that isn't tied to a task or a
// calendar event. Unlike /api/cron/reminders (event reminders, bundled onto
// a once-a-day schedule because of the old Vercel Hobby cron limit), this
// is wired as its own cron entry in vercel.json running every minute, now
// that the project is on a plan that allows per-minute cron - a reminder
// set for 2:17pm should fire at 2:17pm, not whenever the next 8am daily
// sweep happens to land.
const RECURRENCE_INTERVALS: Record<string, string> = {
  DAILY: "1 day",
  WEEKLY: "7 days",
  MONTHLY: "1 month",
  YEARLY: "1 year",
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization")
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Due = PENDING, remind_at has arrived, and we haven't already sent for
    // this occurrence (sent_at gets cleared when a recurring reminder rolls
    // forward to its next remind_at, and when a user edits remind_at).
    const due = await sql`
      SELECT r.id, r.title, r.description, r.remind_at, r.user_id,
             r.is_recurring, r.recurrence_rule, r.notify_channels,
             u.email, u.phone, u.timezone
      FROM reminders r
      JOIN users u ON u.id = r.user_id
      WHERE r.status = 'PENDING'
        AND r.remind_at <= NOW()
        AND r.sent_at IS NULL
      ORDER BY r.remind_at ASC
      LIMIT 200
    `

    let sent = 0
    let recurred = 0

    for (const reminder of due) {
      const channels: string[] = reminder.notify_channels || ['in_app', 'push', 'email']

      const settings = await sql`
        SELECT push_enabled, email_enabled, sms_enabled, quiet_hours_start, quiet_hours_end
        FROM reminder_settings
        WHERE user_id = ${reminder.user_id}
      `
      const userSettings = settings[0] || { push_enabled: true, email_enabled: true, sms_enabled: false }

      // Respect quiet hours the same way the event-reminder cron does,
      // rather than waking someone up for a personal reminder at 3am.
      if (isQuietNow(userSettings.quiet_hours_start, userSettings.quiet_hours_end, reminder.timezone)) {
        continue
      }

      // In-app notification row, always written (matches createNotification's
      // own always-on in_app behavior).
      if (channels.includes('in_app')) {
        await sql`
          INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at)
          VALUES (
            ${crypto.randomUUID()}, ${reminder.user_id}, 'REMINDER',
            ${reminder.title},
            ${reminder.description || 'Reminder'},
            ${JSON.stringify({ reminderId: reminder.id })}::jsonb,
            false, NOW()
          )
        `
      }

      if (channels.includes('push') && userSettings.push_enabled) {
        try {
          await sendPushToUser(reminder.user_id, {
            title: reminder.title,
            body: reminder.description || 'Reminder',
            data: { type: 'REMINDER', reminderId: reminder.id },
            clickAction: '/dashboard/reminders',
          })
        } catch (pushError) {
          console.error('[Reminder] Push send failed (non-fatal):', pushError)
        }
      }

      if (channels.includes('email') && userSettings.email_enabled && reminder.email && isResendConfigured()) {
        try {
          await sendEmail({
            to: reminder.email,
            subject: `Reminder: ${reminder.title}`,
            html: `<p>${reminder.title}</p>${reminder.description ? `<p>${reminder.description}</p>` : ''}`,
            text: `${reminder.title}${reminder.description ? `\n\n${reminder.description}` : ''}`,
          })
        } catch (emailError) {
          console.error('[Reminder] Email send failed (non-fatal):', emailError)
        }
      }

      if (channels.includes('sms') && userSettings.sms_enabled && reminder.phone && isTwilioConfigured()) {
        try {
          await sendSMS({
            to: reminder.phone,
            body: `Togethr Reminder: ${reminder.title}`.substring(0, 160),
          })
        } catch (smsError) {
          console.error('[Reminder] SMS send failed (non-fatal):', smsError)
        }
      }

      sent++

      if (reminder.is_recurring && reminder.recurrence_rule && RECURRENCE_INTERVALS[reminder.recurrence_rule]) {
        const interval = RECURRENCE_INTERVALS[reminder.recurrence_rule]
        await sql`
          UPDATE reminders
          SET remind_at = remind_at + ${interval}::interval,
              sent_at = NULL,
              updated_at = NOW()
          WHERE id = ${reminder.id}
        `
        recurred++
      } else {
        await sql`
          UPDATE reminders
          SET sent_at = NOW(), updated_at = NOW()
          WHERE id = ${reminder.id}
        `
      }
    }

    return NextResponse.json({ success: true, sent, recurred, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Process standalone reminders error:", error)
    return NextResponse.json({ error: "Failed to process reminders" }, { status: 500 })
  }
}
