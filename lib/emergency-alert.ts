import { sql } from "./db"
import { ddl } from "./schema-snapshot"
import { sendPushToUser, isFirebaseConfigured } from "./services/push"
import { sendSMSMetered, isTwilioConfigured } from "./services/sms"

// Parent/guardian -> child emergency alert ("call me / reply now").
// Lazy idempotent schema, same approach as lib/sos.ts.
let ensured: Promise<void> | null = null
export function ensureEmergencyAlertSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`
        CREATE TABLE IF NOT EXISTS emergency_alerts (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          sender_user_id TEXT NOT NULL,
          child_member_id TEXT NOT NULL,
          child_user_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          acked_at TIMESTAMPTZ
        )
      `
      await ddl`
        CREATE TABLE IF NOT EXISTS emergency_alert_deliveries (
          id SERIAL PRIMARY KEY,
          alert_id TEXT NOT NULL,
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

export const EMERGENCY_WINDOW_MINUTES = 60
export const EMERGENCY_LIMIT_PER_CHILD = 3 // per parent, per child, per hour
export const EMERGENCY_COOLDOWN_SECONDS = 60 // between presses for the same child

export type ChannelStatus = "sent" | "failed" | "skipped"
export interface EmergencyDeliveryResult {
  inApp: ChannelStatus
  push: ChannelStatus
  sms: ChannelStatus
  smsReason?: string
}

async function record(alertId: string, channel: string, status: ChannelStatus, detail?: string) {
  try {
    await sql`
      INSERT INTO emergency_alert_deliveries (alert_id, channel, status, detail)
      VALUES (${alertId}, ${channel}, ${status}, ${detail ? detail.slice(0, 300) : null})
    `
  } catch (e) {
    console.error("Emergency alert record failed:", e)
  }
}

// An emergency alert is urgent: never blocked by the monthly SMS quota, but
// each text that goes out still counts toward it (failed attempts don't).
async function sendSmsWithRetry(to: string, body: string, familyId?: string, userId?: string): Promise<{ ok: boolean; error?: string }> {
  let last = "unknown error"
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await sendSMSMetered({ to, body, familyId, userId, urgent: true })
    if (r.success) return { ok: true }
    last = r.error || last
    if (/not a valid|unverified|invalid|blacklist|not configured|unsubscribed|opted/i.test(last)) break
    await new Promise((res) => setTimeout(res, 600 * (attempt + 1)))
  }
  return { ok: false, error: last }
}

/** Alert one child on every urgent channel at once: push (urgent), text, in-app. */
export async function dispatchEmergencyAlert(opts: {
  alertId: string
  senderName: string
  childUserId: string
  /** Family whose SMS count the text adds to (it is never blocked). */
  familyId?: string
}): Promise<EmergencyDeliveryResult> {
  const { alertId, senderName, childUserId, familyId } = opts
  const child = (await sql`
    SELECT u.phone, rs.sms_enabled FROM users u
    LEFT JOIN reminder_settings rs ON rs.user_id = u.id
    WHERE u.id = ${childUserId}
  `)[0]

  const title = `Urgent: ${senderName} needs you`
  const body = `${senderName} needs you to call or reply right now. Tap "I'm OK" if you're safe, or call back.`
  const smsBody = `TOGETHR ALERT: ${senderName} needs you to call or reply right now. Please contact them as soon as you see this.`
  const out: EmergencyDeliveryResult = { inApp: "failed", push: "skipped", sms: "skipped" }
  const tasks: Promise<void>[] = []

  tasks.push((async () => {
    try {
      await sql`
        INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
        VALUES (${`notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`}, ${childUserId}, 'LOCATION_ALERT', ${title}, ${body},
          ${JSON.stringify({ subType: "EMERGENCY_ALERT", alertId })}::jsonb, NOW())
      `
      out.inApp = "sent"
    } catch (e) {
      console.error("Emergency in-app failed:", e)
    }
    await record(alertId, "in_app", out.inApp)
  })())

  if (isFirebaseConfigured()) {
    tasks.push((async () => {
      try {
        const p = await sendPushToUser(childUserId, {
          title,
          body,
          urgent: true,
          data: { type: "emergency", alertId },
          clickAction: "/location",
        })
        out.push = p.sent > 0 ? "sent" : "failed"
        await record(alertId, "push", out.push, p.sent === 0 && p.failed === 0 ? "no registered device" : `sent ${p.sent}, failed ${p.failed}`)
      } catch (e) {
        out.push = "failed"
        await record(alertId, "push", "failed", String(e))
      }
    })())
  }

  if (child?.phone && isTwilioConfigured() && child.sms_enabled !== false) {
    tasks.push((async () => {
      const s = await sendSmsWithRetry(child.phone, smsBody, familyId, childUserId)
      out.sms = s.ok ? "sent" : "failed"
      if (!s.ok) out.smsReason = s.error
      await record(alertId, "sms", out.sms, s.error)
    })())
  } else {
    const why = !child?.phone ? "no phone number on file" : !isTwilioConfigured() ? "SMS not configured" : "SMS turned off by user"
    out.smsReason = why
    tasks.push(record(alertId, "sms", "skipped", why))
  }

  await Promise.all(tasks)
  return out
}

/** Tell the parent their child answered "I'm OK". */
export async function notifyParentAcked(senderUserId: string, childName: string) {
  const title = `${childName} replied: I'm OK`
  const body = `${childName} saw your emergency alert and says they are OK. Call them if you still need to talk.`
  try {
    await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
      VALUES (${`notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`}, ${senderUserId}, 'LOCATION_ALERT', ${title}, ${body},
        ${JSON.stringify({ subType: "EMERGENCY_ACK" })}::jsonb, NOW())
    `
  } catch (e) {
    console.error("Emergency ack in-app failed:", e)
  }
  if (isFirebaseConfigured()) {
    try {
      await sendPushToUser(senderUserId, { title, body, urgent: true, data: { type: "emergency-ack" }, clickAction: "/location" })
    } catch (e) {
      console.error("Emergency ack push failed:", e)
    }
  }
}
