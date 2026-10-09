import { sql } from "./db"
import { sendPushToUser, isFirebaseConfigured } from "./services/push"
import { sendSMS, isTwilioConfigured } from "./services/sms"
import { sendEmail, isResendConfigured } from "./services/email"

// Lazy idempotent schema (prod SQL scripts are never run by hand).
let ensured: Promise<void> | null = null
export function ensureSosSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS sos_events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          family_id TEXT NOT NULL,
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          location_source TEXT,
          message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS sos_deliveries (
          id SERIAL PRIMARY KEY,
          event_id TEXT NOT NULL,
          recipient_user_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          status TEXT NOT NULL,
          detail TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

export type ChannelStatus = "sent" | "failed" | "skipped"
export interface RecipientResult {
  name: string
  inApp: ChannelStatus
  push: ChannelStatus
  sms: ChannelStatus
  email: ChannelStatus
  smsReason?: string
}

export interface SosInput {
  eventId: string
  familyId: string
  senderId: string
  senderName: string
  latitude: number | null
  longitude: number | null
  locationNote: string // e.g. "live GPS" or "last known, 12 min ago"
  message?: string
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))

async function record(eventId: string, userId: string, channel: string, status: ChannelStatus, detail?: string) {
  try {
    await sql`
      INSERT INTO sos_deliveries (event_id, recipient_user_id, channel, status, detail)
      VALUES (${eventId}, ${userId}, ${channel}, ${status}, ${detail ? detail.slice(0, 300) : null})
    `
  } catch (e) {
    console.error("SOS record failed:", e)
  }
}

async function sendSmsWithRetry(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  let last = "unknown error"
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await sendSMS({ to, body })
    if (r.success) return { ok: true }
    last = r.error || last
    // permanent errors (bad number etc.) won't improve on retry
    if (/not a valid|unverified|invalid|blacklist|not configured|unsubscribed|opted/i.test(last)) break
    await new Promise((res) => setTimeout(res, 600 * (attempt + 1)))
  }
  return { ok: false, error: last }
}

/** Alert every parent/guardian (or, if none, every other member) on all channels in parallel. */
export async function dispatchSos(input: SosInput): Promise<RecipientResult[]> {
  const { eventId, familyId, senderId, senderName, latitude, longitude, locationNote } = input
  const hasLoc = latitude != null && longitude != null
  const mapUrl = hasLoc ? `https://maps.google.com/?q=${latitude},${longitude}` : null

  let recipients = await sql`
    SELECT fm.user_id, u.email, u.phone, u.first_name, rs.email_enabled, rs.sms_enabled
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN reminder_settings rs ON rs.user_id = fm.user_id
    WHERE fm.family_id = ${familyId} AND fm.is_active = true AND fm.user_id != ${senderId}
      AND fm.role IN ('PARENT', 'GUARDIAN')
  `
  if (recipients.length === 0) {
    // No other adult: an emergency should still reach whoever is in the family.
    recipients = await sql`
      SELECT fm.user_id, u.email, u.phone, u.first_name, rs.email_enabled, rs.sms_enabled
      FROM family_members fm
      JOIN users u ON u.id = fm.user_id
      LEFT JOIN reminder_settings rs ON rs.user_id = fm.user_id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true AND fm.user_id != ${senderId}
    `
  }

  const title = `SOS from ${senderName}`
  const note = input.message ? ` "${input.message}"` : ""
  const inAppBody = `${senderName} pressed SOS and needs help.${note}${mapUrl ? ` Location (${locationNote}): ${mapUrl}` : " No location available - call them now."}`
  // SMS: location link first so it can never be truncated away.
  const smsBody = mapUrl
    ? `TOGETHR SOS! ${senderName} needs help. Map (${locationNote}): ${mapUrl}${note} Call them now.`
    : `TOGETHR SOS! ${senderName} needs help (no location available).${note} Call them now.`

  const results = await Promise.all(
    recipients.map(async (r): Promise<RecipientResult> => {
      const out: RecipientResult = { name: r.first_name || "Family member", inApp: "failed", push: "skipped", sms: "skipped", email: "skipped" }
      const tasks: Promise<void>[] = []

      tasks.push((async () => {
        try {
          await sql`
            INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
            VALUES (${`notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`}, ${r.user_id}, 'LOCATION_ALERT', ${title}, ${inAppBody},
              ${JSON.stringify({ subType: "SOS", userId: senderId, latitude, longitude, eventId })}::jsonb, NOW())
          `
          out.inApp = "sent"
        } catch (e) {
          console.error("SOS in-app failed:", e)
        }
        await record(eventId, r.user_id, "in_app", out.inApp)
      })())

      if (isFirebaseConfigured()) {
        tasks.push((async () => {
          try {
            const p = await sendPushToUser(r.user_id, {
              title,
              body: inAppBody,
              data: { type: "LOCATION_ALERT", subType: "SOS", userId: senderId, eventId, ...(hasLoc ? { latitude: String(latitude), longitude: String(longitude) } : {}) },
              clickAction: "/location",
            })
            out.push = p.sent > 0 ? "sent" : "failed"
            await record(eventId, r.user_id, "push", out.push, p.sent === 0 && p.failed === 0 ? "no registered device" : `sent ${p.sent}, failed ${p.failed}`)
          } catch (e) {
            out.push = "failed"
            await record(eventId, r.user_id, "push", "failed", String(e))
          }
        })())
      }

      // Emergency: text unless the person explicitly turned SMS off.
      if (r.phone && isTwilioConfigured() && r.sms_enabled !== false) {
        tasks.push((async () => {
          const s = await sendSmsWithRetry(r.phone, smsBody)
          out.sms = s.ok ? "sent" : "failed"
          if (!s.ok) {
            out.smsReason = s.error
            console.error("SOS SMS failed for", r.user_id, s.error)
          }
          await record(eventId, r.user_id, "sms", out.sms, s.error)
        })())
      } else {
        const why = !r.phone ? "no phone number on file" : !isTwilioConfigured() ? "SMS not configured" : "SMS turned off by user"
        out.smsReason = why
        tasks.push(record(eventId, r.user_id, "sms", "skipped", why))
      }

      if (r.email && isResendConfigured() && r.email_enabled !== false) {
        tasks.push((async () => {
          try {
            const e = await sendEmail({
              to: r.email,
              subject: `SOS: ${senderName} needs help`,
              html: `<p><strong>${esc(title)}</strong></p><p>${esc(inAppBody)}</p>${mapUrl ? `<p><a href="${mapUrl}">Open location in Maps</a></p>` : ""}`,
              text: `${title}\n\n${inAppBody}`,
            })
            out.email = e.success ? "sent" : "failed"
            await record(eventId, r.user_id, "email", out.email, e.error)
          } catch (err) {
            out.email = "failed"
            await record(eventId, r.user_id, "email", "failed", String(err))
          }
        })())
      }

      await Promise.all(tasks)
      return out
    })
  )
  return results
}
