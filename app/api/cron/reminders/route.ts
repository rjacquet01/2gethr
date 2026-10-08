import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { sendPushToUser } from "@/lib/services/push"
import { sendEmail, isResendConfigured } from "@/lib/services/email"
import { sendSMS, isTwilioConfigured } from "@/lib/services/sms"
import { isQuietNow } from "@/lib/quiet-hours"
import { tierHasFeature } from "@/lib/subscription-tiers"

// This endpoint processes event reminders, refreshes the digest recipients
// cache (stats only - it does not send anything), and auto-archives old
// tasks/events. Runs daily at 8 AM UTC - combined into single cron for
// Hobby account limit.
//
// The weekly digest EMAIL send lives entirely in its own dedicated cron
// (/api/cron/weekly-digest, scheduled directly in vercel.json for Sunday
// 13:00 UTC / 9am Eastern). This endpoint used to also call that digest
// endpoint internally whenever it happened to run on a Sunday - which,
// combined with the dedicated cron, meant the digest logic fired twice
// every Sunday, 5 hours apart. Removed that internal trigger so there is
// exactly one scheduled source of truth for sending the digest.
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret in production
    const authHeader = request.headers.get("Authorization")
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date()

    // End expired free trials: a family still TRIALING past trial_ends_at that
    // never subscribed through Stripe drops back to the Free plan. (Access is
    // also cut off immediately by checkFamilySubscription; this keeps the
    // stored tier/status honest for the subscription page and admin views.)
    try {
      const expiredTrials = await sql`
        UPDATE subscriptions
        SET tier = 'FREE', status = 'ACTIVE', updated_at = NOW()
        WHERE status = 'TRIALING'
          AND trial_ends_at IS NOT NULL
          AND trial_ends_at < NOW()
          AND stripe_subscription_id IS NULL
        RETURNING id
      `
      if (expiredTrials.length > 0) {
        console.log(`[Cron] Ended ${expiredTrials.length} expired free trial(s)`)
      }
    } catch (trialError) {
      console.error("[Cron] Failed to end expired trials:", trialError)
    }

    // Find events that need reminders sent
    // Look for events starting in the next 60 minutes that have reminder_minutes set
    //
    // e.status checks against the events.status Postgres enum, whose only
    // valid values are PENDING/APPROVED/REJECTED/CANCELLED/ARCHIVED - there
    // is no CONFIRMED. The previous 'CONFIRMED' literal here made every run
    // of this query throw NeonDbError "invalid input value for enum
    // event_status" before any reminder could ever be found, so no event
    // reminder (push, SMS, or email) has ever actually fired. APPROVED is
    // the status normal (non-rejected, non-cancelled) events end up with.
    const upcomingEvents = await sql`
      SELECT
        e.id, e.title, e.start_time, e.reminder_minutes, e.location,
        e.created_by_id, e.calendar_id,
        c.family_id
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      WHERE e.start_time > NOW()
        AND e.start_time <= NOW() + INTERVAL '60 minutes'
        AND e.status = 'APPROVED'
        AND e.reminder_minutes IS NOT NULL
        AND array_length(e.reminder_minutes, 1) > 0
    `

    let remindersSent = 0

    for (const event of upcomingEvents) {
      const eventStart = new Date(event.start_time)
      const minutesUntilEvent = Math.floor((eventStart.getTime() - now.getTime()) / (1000 * 60))

      // Check if any reminder minute matches (within 1 minute window)
      const reminderMinutes = event.reminder_minutes || []
      const shouldSendReminder = reminderMinutes.some((min: number) =>
        Math.abs(minutesUntilEvent - min) < 1
      )

      if (!shouldSendReminder) continue

      // Get all participants and family members who should receive the reminder
      const participants = await sql`
        SELECT DISTINCT u.id, u.email, u.phone, u.first_name
        FROM users u
        JOIN family_members fm ON u.id = fm.user_id
        WHERE fm.family_id = ${event.family_id}
          AND fm.is_active = true
        UNION
        SELECT DISTINCT u.id, u.email, u.phone, u.first_name
        FROM users u
        JOIN event_participants ep ON u.id = ep.user_id
        WHERE ep.event_id = ${event.id}
          AND ep.status != 'DECLINED'
      `

      // Create notifications for each participant
      for (const participant of participants) {
        // Check if we already sent this reminder
        const existing = await sql`
          SELECT id FROM notifications
          WHERE user_id = ${participant.id}
            AND type = 'EVENT_REMINDER'
            AND (data->>'eventId')::text = ${event.id}
            AND (data->>'reminderMinutes')::int = ${minutesUntilEvent}
            AND created_at > NOW() - INTERVAL '5 minutes'
        `

        if (existing.length > 0) continue

        // Get user's reminder settings
        const settings = await sql`
          SELECT push_enabled, email_enabled, sms_enabled, quiet_hours_start, quiet_hours_end
          FROM reminder_settings
          WHERE user_id = ${participant.id}
        `

        const userSettings = settings[0] || { push_enabled: true, email_enabled: true, sms_enabled: false }

        // Check quiet hours (in the user's own timezone)
        const tzRow = await sql`SELECT timezone FROM users WHERE id = ${participant.id}`
        if (isQuietNow(userSettings.quiet_hours_start, userSettings.quiet_hours_end, tzRow[0]?.timezone)) {
          continue // Skip during quiet hours
        }

        // Create in-app notification
        const notificationId = crypto.randomUUID()
        const timeText = minutesUntilEvent <= 1
          ? "now"
          : minutesUntilEvent < 60
            ? `in ${minutesUntilEvent} minutes`
            : `in ${Math.floor(minutesUntilEvent / 60)} hour${Math.floor(minutesUntilEvent / 60) > 1 ? 's' : ''}`

        await sql`
          INSERT INTO notifications (
            id, user_id, type, title, body, data, is_read, created_at
          )
          VALUES (
            ${notificationId},
            ${participant.id},
            'EVENT_REMINDER',
            ${'Upcoming: ' + event.title},
            ${`${event.title} starts ${timeText}${event.location ? ` at ${event.location}` : ''}`},
            ${JSON.stringify({
              eventId: event.id,
              reminderMinutes: minutesUntilEvent,
              startTime: event.start_time,
              location: event.location,
            })},
            false,
            NOW()
          )
        `

        remindersSent++

        // Send real push notification (system-level, via the service worker's
        // showNotification call) when the user has push enabled in Settings.
        if (userSettings.push_enabled) {
          try {
            await sendPushToUser(participant.id, {
              title: 'Upcoming: ' + event.title,
              body: `${event.title} starts ${timeText}${event.location ? ` at ${event.location}` : ''}`,
              data: { type: 'EVENT_REMINDER', eventId: event.id },
              clickAction: `/calendar/event/${event.id}`,
            })
          } catch (pushError) {
            console.error('[Reminder] Push send failed (non-fatal):', pushError)
          }
        }

        // Send email when the user has email enabled in Settings.
        if (userSettings.email_enabled && participant.email && isResendConfigured()) {
          try {
            await sendEmail({
              to: participant.email,
              subject: `Reminder: ${event.title}`,
              html: `<p>${event.title} starts ${timeText}${event.location ? ` at ${event.location}` : ''}.</p>`,
              text: `${event.title} starts ${timeText}${event.location ? ` at ${event.location}` : ''}.`,
            })
          } catch (emailError) {
            console.error('[Reminder] Email send failed (non-fatal):', emailError)
          }
        }

        // Check if family has SMS/Phone alert features based on subscription.
        // Reads the same per-tier flags lib/subscription-tiers.ts defines
        // for the in-app UI, so this enforcement can't silently drift from
        // what Settings tells the user they have.
        const familySubscription = await sql`
          SELECT tier FROM subscriptions
          WHERE family_id = ${event.family_id}
          AND status IN ('ACTIVE', 'TRIALING')
          ORDER BY created_at DESC LIMIT 1
        `

        const tier = familySubscription.length > 0 ? familySubscription[0].tier : 'FREE'
        const hasSmsNotifications = tierHasFeature(tier, 'smsNotifications')
        const hasPhoneAlerts = tierHasFeature(tier, 'phoneAlerts')

        // Send SMS only when: the user toggled sms_enabled on in Settings,
        // AND the family's subscription tier actually grants SMS (business
        // rule, independent of the user's own toggle), AND Twilio is
        // configured, AND we have a phone number on file.
        if (userSettings.sms_enabled && hasSmsNotifications && participant.phone && isTwilioConfigured()) {
          try {
            await sendSMS({
              to: participant.phone,
              body: `Togethr Reminder: "${event.title}" starts ${timeText}${event.location ? ` at ${event.location}` : ''}.`,
            })
          } catch (smsError) {
            console.error('[Reminder] SMS send failed (non-fatal):', smsError)
          }
        }

        // Phone (voice) alerts are a Premium Plus-only add-on with no
        // implementation yet elsewhere in the app (no sendPhoneAlert
        // service exists). Left as a log line rather than silently
        // claiming to send something that doesn't exist.
        if (hasPhoneAlerts && participant.phone) {
          console.log(`[Reminder] Family ${event.family_id} (${tier}): phone-alert eligible, not yet implemented`)
        }
      }
    }

    // Refresh digest recipients cache stats (informational only - this cron
    // does not send the weekly digest; see the dedicated cron noted above)
    const digestStats = await sql`
      SELECT
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT f.id) as total_families,
        COUNT(DISTINCT CASE WHEN fm.role = 'PARENT' THEN u.id END) as parents,
        COUNT(DISTINCT CASE WHEN fm.role = 'GUARDIAN' THEN u.id END) as guardians
      FROM users u
      JOIN family_members fm ON u.id = fm.user_id
      JOIN families f ON fm.family_id = f.id
      LEFT JOIN reminder_settings rs ON u.id = rs.user_id
      WHERE u.is_active = true
      AND fm.is_active = true
      AND fm.role IN ('PARENT', 'GUARDIAN')
      AND (rs.weekly_digest = true OR rs.weekly_digest IS NULL)
    `

    console.log('[Cron] Digest recipients refresh:', digestStats[0])

    // Auto-archive completed/cancelled tasks and past events so the Archive
    // page actually fills up as an audit trail, instead of only being
    // reachable through the (UI-unreachable) manual bulk-archive endpoints.
    // Grace windows keep items visible in the normal lists for a bit after
    // they're done, rather than vanishing into the Archive the instant a
    // task is checked off or an event ends:
    //   - tasks: COMPLETED/CANCELLED for at least 7 days
    //   - events: ended at least 1 day ago
    // task_history.user_id is NOT NULL (no "system" actor), so each
    // auto-archived task's history row is attributed to the task's own
    // creator (created_by_id), with new_value marking it as an automated
    // action distinct from the user-triggered bulk endpoint's {"bulk":true}.
    let tasksArchived = 0
    let eventsArchived = 0
    try {
      const archivedTasks = await sql`
        UPDATE tasks
        SET status = 'ARCHIVED', updated_at = NOW()
        WHERE status IN ('COMPLETED', 'CANCELLED')
        AND updated_at < NOW() - INTERVAL '7 days'
        RETURNING id, created_by_id
      `

      for (const task of archivedTasks) {
        if (!task.created_by_id) continue
        await sql`
          INSERT INTO task_history (task_id, user_id, action, new_value)
          VALUES (${task.id}, ${task.created_by_id}, 'ARCHIVED', '{"auto": true}'::jsonb)
        `
      }
      tasksArchived = archivedTasks.length

      const archivedEvents = await sql`
        UPDATE events e
        SET status = 'ARCHIVED'
        FROM calendars c
        WHERE e.calendar_id = c.id
        AND e.end_time < NOW() - INTERVAL '1 day'
        AND e.status != 'ARCHIVED'
        AND e.status != 'CANCELLED'
        RETURNING e.id
      `
      eventsArchived = archivedEvents.length

      console.log(`[Cron] Auto-archive: ${tasksArchived} task(s), ${eventsArchived} event(s)`)
    } catch (archiveError) {
      console.error('[Cron] Auto-archive error (non-fatal):', archiveError)
    }

    return NextResponse.json({
      success: true,
      remindersSent,
      tasksArchived,
      eventsArchived,
      digestStats: digestStats[0],
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error("Process reminders error:", error)
    return NextResponse.json({ error: "Failed to process reminders" }, { status: 500 })
  }
}
