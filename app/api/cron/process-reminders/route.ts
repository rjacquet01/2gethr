import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { sendPushToUser } from "@/lib/services/push"
import { sendEmail, isResendConfigured } from "@/lib/services/email"
import { sendSMSMetered, isTwilioConfigured } from "@/lib/services/sms"
import { ensureReminderChildColumn } from "@/lib/reminder-schema"
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
    if (process.env.CRON_SECRET ? authHeader !== `Bearer ${process.env.CRON_SECRET}` : process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await ensureReminderChildColumn()

    // Due = PENDING, remind_at has arrived, and we haven't already sent for
    // this occurrence (sent_at gets cleared when a recurring reminder rolls
    // forward to its next remind_at, and when a user edits remind_at).
    const due = await sql`
      SELECT r.id, r.title, r.description, r.remind_at, r.user_id, r.family_id,
             r.is_recurring, r.recurrence_rule, r.notify_channels,
             u.email, u.phone, u.timezone,
             cp.display_name as child_name, cfm.user_id as child_user_id
      FROM reminders r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN child_profiles cp ON cp.id = r.child_profile_id
      LEFT JOIN family_members cfm ON cfm.id = cp.family_member_id
      WHERE r.status = 'PENDING'
        AND r.remind_at <= NOW()
        AND r.sent_at IS NULL
        -- A kid's "Ask a parent" reminder fires only once a parent approves it.
        AND (r.approval_status IS NULL OR r.approval_status = 'APPROVED')
      -- Reminders waiting out quiet hours stay at the front; a larger batch
      -- keeps them from crowding out newer due ones.
      ORDER BY r.remind_at ASC
      LIMIT 500
    `

    let sent = 0
    let recurred = 0

    for (const reminder of due) {
      const channels: string[] = reminder.notify_channels || ['in_app', 'push', 'email']
      // Reminders set for a child who has no login of their own go to the
      // parent who created them, so name the child in the message.
      const displayTitle: string =
        reminder.child_name && reminder.child_user_id !== reminder.user_id
          ? `For ${reminder.child_name}: ${reminder.title}`
          : reminder.title

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

      // Claim this occurrence before sending: runs are every minute and a
      // slow one can overlap the next, which used to send everything twice.
      const claimed = await sql`
        UPDATE reminders SET sent_at = NOW(), updated_at = NOW()
        WHERE id = ${reminder.id} AND sent_at IS NULL
        RETURNING id
      `
      if (claimed.length === 0) continue

      // In-app notification row, always written (matches createNotification's
      // own always-on in_app behavior).
      if (channels.includes('in_app')) {
        await sql`
          INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at)
          VALUES (
            ${crypto.randomUUID()}, ${reminder.user_id}, 'REMINDER',
            ${displayTitle},
            ${reminder.description || 'Reminder'},
            ${JSON.stringify({ reminderId: reminder.id })}::jsonb,
            false, NOW()
          )
        `
      }

      if (channels.includes('push') && userSettings.push_enabled) {
        try {
          await sendPushToUser(reminder.user_id, {
            title: displayTitle,
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
            subject: `Reminder: ${displayTitle}`,
            html: `<p>${displayTitle}</p>${reminder.description ? `<p>${reminder.description}</p>` : ''}`,
            text: `${displayTitle}${reminder.description ? `\n\n${reminder.description}` : ''}`,
          })
        } catch (emailError) {
          console.error('[Reminder] Email send failed (non-fatal):', emailError)
        }
      }

      if (channels.includes('sms') && userSettings.sms_enabled && reminder.phone && isTwilioConfigured()) {
        try {
          // Counts against the family's monthly SMS quota.
          await sendSMSMetered({
            familyId: reminder.family_id,
            userId: reminder.user_id,
            to: reminder.phone,
            body: `Togethr: Reminder - ${displayTitle}`,
          })
        } catch (smsError) {
          console.error('[Reminder] SMS send failed (non-fatal):', smsError)
        }
      }

      sent++

      if (reminder.is_recurring && reminder.recurrence_rule && RECURRENCE_INTERVALS[reminder.recurrence_rule]) {
        // Next occurrence on the user's own clock (8am stays 8am across a DST
        // change), skipping any occurrences already in the past so a reminder
        // that fell behind doesn't fire once a minute to catch up.
        const interval = RECURRENCE_INTERVALS[reminder.recurrence_rule]
        const tz: string = reminder.timezone || 'UTC'
        await sql`
          UPDATE reminders
          SET remind_at = COALESCE((
                SELECT ((r0.remind_at AT TIME ZONE ${tz}) + (n * ${interval}::interval)) AT TIME ZONE ${tz}
                FROM generate_series(1, 1000) AS n
                WHERE ((r0.remind_at AT TIME ZONE ${tz}) + (n * ${interval}::interval)) AT TIME ZONE ${tz} > NOW()
                ORDER BY n
                LIMIT 1
              ), NOW() + ${interval}::interval),
              sent_at = NULL,
              updated_at = NOW()
          FROM reminders r0
          WHERE reminders.id = ${reminder.id} AND r0.id = reminders.id
        `
        recurred++
      }
    }

    return NextResponse.json({ success: true, sent, recurred, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Process standalone reminders error:", error)
    return NextResponse.json({ error: "Failed to process reminders" }, { status: 500 })
  }
}
