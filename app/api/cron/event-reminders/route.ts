import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { sendPushToUser } from "@/lib/services/push"
import { sendEmail, isResendConfigured } from "@/lib/services/email"
import { sendSMS, isTwilioConfigured } from "@/lib/services/sms"
import { isQuietNow } from "@/lib/quiet-hours"
import { tierHasFeature } from "@/lib/subscription-tiers"

// Event reminders, every minute. The older /api/cron/reminders only runs once a
// day (08:00 UTC), so an event reminder (15 min before, at start, ...) could
// essentially never land on time. Here an offset is "due" once
// now >= start - offset and the event hasn't started more than a few minutes ago,
// and each (event, user, offset) is only ever sent once.
const GRACE_MINUTES = 3

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization")
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date()
    const events = await sql`
      SELECT e.id, e.title, e.start_time, e.reminder_minutes, e.location, e.visibility, e.created_by_id, e.notify_channels, c.family_id
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      WHERE e.status = 'APPROVED'
        AND e.reminder_minutes IS NOT NULL
        AND array_length(e.reminder_minutes, 1) > 0
        AND e.start_time > NOW() - make_interval(mins => ${GRACE_MINUTES}::int)
        AND e.start_time <= NOW() + INTERVAL '25 hours'
      LIMIT 500
    `

    let sent = 0
    for (const event of events) {
      const start = new Date(event.start_time).getTime()
      const offsets: number[] = (event.reminder_minutes || []).filter((m: unknown) => typeof m === "number")
      // offsets whose moment has arrived (and not by more than the grace window past the start)
      const dueOffsets = offsets.filter((m) => now.getTime() >= start - m * 60_000)
      if (dueOffsets.length === 0) continue
      // only the most imminent due offset matters if several are already due (e.g. event just created)
      const offset = Math.min(...dueOffsets)

      // FAMILY events remind everyone in the family; PRIVATE / SELECTED_MEMBERS
      // events only remind the creator and the chosen participants.
      const participants = event.visibility === "FAMILY" || !event.visibility
        ? await sql`
            SELECT DISTINCT u.id, u.email, u.phone, u.timezone
            FROM users u JOIN family_members fm ON u.id = fm.user_id
            WHERE fm.family_id = ${event.family_id} AND fm.is_active = true
            UNION
            SELECT DISTINCT u.id, u.email, u.phone, u.timezone
            FROM users u JOIN event_participants ep ON u.id = ep.user_id
            WHERE ep.event_id = ${event.id} AND ep.status != 'DECLINED'
          `
        : await sql`
            SELECT DISTINCT u.id, u.email, u.phone, u.timezone
            FROM users u
            WHERE u.id = ${event.created_by_id}
            UNION
            SELECT DISTINCT u.id, u.email, u.phone, u.timezone
            FROM users u JOIN event_participants ep ON u.id = ep.user_id
            WHERE ep.event_id = ${event.id} AND ep.status != 'DECLINED'
          `
      const channels: string[] = event.notify_channels || ["in_app", "push", "email", "sms"]

      const minsLeft = Math.max(0, Math.round((start - now.getTime()) / 60_000))
      const timeText = minsLeft <= 1 ? "now" : minsLeft < 60 ? `in ${minsLeft} minutes` : `in ${Math.floor(minsLeft / 60)} hour${Math.floor(minsLeft / 60) > 1 ? "s" : ""}`
      const body = `${event.title} starts ${timeText}${event.location ? ` at ${event.location}` : ""}`

      const tierRows = await sql`
        SELECT tier FROM subscriptions WHERE family_id = ${event.family_id} AND status IN ('ACTIVE', 'TRIALING')
        ORDER BY created_at DESC LIMIT 1
      `
      const hasSms = tierHasFeature(tierRows.length > 0 ? tierRows[0].tier : "FREE", "smsNotifications")

      for (const p of participants) {
        const already = await sql`
          SELECT 1 FROM notifications
          WHERE user_id = ${p.id} AND type = 'EVENT_REMINDER'
            AND data->>'eventId' = ${event.id} AND data->>'offset' = ${String(offset)}
            AND data->>'startTime' = ${new Date(event.start_time).toISOString()}
          LIMIT 1
        `
        if (already.length > 0) continue

        const settings = await sql`
          SELECT push_enabled, email_enabled, sms_enabled, quiet_hours_start, quiet_hours_end
          FROM reminder_settings WHERE user_id = ${p.id}
        `
        const us = settings[0] || { push_enabled: true, email_enabled: true, sms_enabled: false }
        if (isQuietNow(us.quiet_hours_start, us.quiet_hours_end, p.timezone)) continue

        await sql`
          INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at)
          VALUES (${crypto.randomUUID()}, ${p.id}, 'EVENT_REMINDER', ${"Upcoming: " + event.title}, ${body},
            ${JSON.stringify({ eventId: event.id, offset: String(offset), startTime: new Date(event.start_time).toISOString(), location: event.location })}::jsonb,
            false, NOW())
        `
        sent++

        if (channels.includes("push") && us.push_enabled) {
          try {
            await sendPushToUser(p.id, { title: "Upcoming: " + event.title, body, data: { type: "EVENT_REMINDER", eventId: event.id }, clickAction: `/calendar/event/${event.id}` })
          } catch (e) {
            console.error("[EventReminder] push failed (non-fatal):", e)
          }
        }
        if (channels.includes("email") && us.email_enabled && p.email && isResendConfigured()) {
          try {
            await sendEmail({ to: p.email, subject: `Reminder: ${event.title}`, html: `<p>${body}.</p>`, text: `${body}.` })
          } catch (e) {
            console.error("[EventReminder] email failed (non-fatal):", e)
          }
        }
        if (channels.includes("sms") && us.sms_enabled && hasSms && p.phone && isTwilioConfigured()) {
          try {
            await sendSMS({ to: p.phone, body: `Togethr Reminder: "${event.title}" starts ${timeText}${event.location ? ` at ${event.location}` : ""}.` })
          } catch (e) {
            console.error("[EventReminder] sms failed (non-fatal):", e)
          }
        }
      }
    }

    return NextResponse.json({ success: true, events: events.length, sent, timestamp: now.toISOString() })
  } catch (error) {
    console.error("Event reminders error:", error)
    return NextResponse.json({ error: "Failed to process event reminders" }, { status: 500 })
  }
}
