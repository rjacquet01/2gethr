import { sql } from "./db"
import { sendPushToUser, isFirebaseConfigured } from "./services/push"
import { sendSMS, isTwilioConfigured } from "./services/sms"
import { sendEmail, isResendConfigured } from "./services/email"

export const APPROVAL_WINDOW_MINUTES = 15
export const APPROVED_WINDOW_MINUTES = 5
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://mytogethr.com"

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))
const newId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

export async function insertNotification(userId: string, title: string, body: string, data: Record<string, unknown>) {
  await sql`
    INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
    VALUES (${newId("notif")}, ${userId}, 'LOCATION_ALERT', ${title}, ${body}, ${JSON.stringify(data)}::jsonb, NOW())
  `
}

/** Ask the target parent to approve a location ping: in-app + push + text + email. Each channel is best-effort. */
export async function sendApprovalRequest(opts: { requestId: string; targetUserId: string; requesterName: string; familyId: string }) {
  const { requestId, targetUserId, requesterName } = opts
  const link = `${APP_URL}/location?approve=${encodeURIComponent(requestId)}`
  const title = "Location ping request"
  const body = `${requesterName} wants to see your current location. Approve or deny in Togethr.`

  const rows = await sql`
    SELECT u.email, u.phone, rs.email_enabled, rs.sms_enabled
    FROM users u LEFT JOIN reminder_settings rs ON rs.user_id = u.id
    WHERE u.id = ${targetUserId} LIMIT 1
  `
  const t = rows[0] || {}
  const tasks: Promise<unknown>[] = []

  tasks.push(
    insertNotification(targetUserId, title, body, { subType: "LOCATION_APPROVAL", requestId, requesterName, familyId: opts.familyId }).catch((e) =>
      console.error("approval in-app failed:", e)
    )
  )
  if (isFirebaseConfigured()) {
    tasks.push(
      sendPushToUser(targetUserId, {
        title,
        body,
        data: { type: "LOCATION_APPROVAL", requestId },
        clickAction: `/location?approve=${encodeURIComponent(requestId)}`,
      }).catch((e) => console.error("approval push failed:", e))
    )
  }
  if (t.phone && isTwilioConfigured() && t.sms_enabled !== false) {
    tasks.push(sendSMS({ to: t.phone, body: `Togethr: ${requesterName} wants to see your location. Approve or deny: ${link}` }).catch((e) => console.error("approval sms failed:", e)))
  }
  if (t.email && isResendConfigured() && t.email_enabled !== false) {
    tasks.push(
      sendEmail({
        to: t.email,
        subject: `${requesterName} is asking for your location`,
        html: `<p><strong>${esc(title)}</strong></p><p>${esc(body)}</p><p><a href="${link}">Review the request</a></p><p>The request expires in ${APPROVAL_WINDOW_MINUTES} minutes. Your location is shared only if you approve.</p>`,
        text: `${title}\n\n${body}\n\nReview: ${link}\n\nExpires in ${APPROVAL_WINDOW_MINUTES} minutes.`,
      }).catch((e) => console.error("approval email failed:", e))
    )
  }
  await Promise.all(tasks)
}

/** Tell the requester how the target responded. */
export async function notifyRequesterOutcome(requesterUserId: string, targetName: string, outcome: "APPROVED" | "DENIED") {
  const title = outcome === "APPROVED" ? "Location ping approved" : "Location ping declined"
  const body = outcome === "APPROVED" ? `${targetName} approved your request. Their location will update shortly.` : `${targetName} declined your location request.`
  try {
    await insertNotification(requesterUserId, title, body, { subType: "LOCATION_APPROVAL_RESULT", outcome })
  } catch (e) {
    console.error("requester in-app failed:", e)
  }
  if (isFirebaseConfigured()) {
    try {
      await sendPushToUser(requesterUserId, { title, body, data: { type: "LOCATION_APPROVAL_RESULT", outcome }, clickAction: "/location" })
    } catch (e) {
      console.error("requester push failed:", e)
    }
  }
}
