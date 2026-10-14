import { sql } from "./db"
import { sendPushToUser, isFirebaseConfigured } from "./services/push"

export const APPROVAL_WINDOW_MINUTES = 24 * 60 // a ping waits up to 24 hours for an answer
export const APPROVED_WINDOW_MINUTES = 5
export const PING_WINDOW_MINUTES = 60
export const PING_LIMIT_ADULT = 5 // parents/guardians: pings per person per hour
export const PING_LIMIT_CHILD = 2 // children: pings per person per hour

const newId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

export async function insertNotification(userId: string, title: string, body: string, data: Record<string, unknown>) {
  await sql`
    INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
    VALUES (${newId("notif")}, ${userId}, 'LOCATION_ALERT', ${title}, ${body}, ${JSON.stringify(data)}::jsonb, NOW())
  `
}

/** Ask the target to approve a one-time location ping: in-app + push only. */
export async function sendApprovalRequest(opts: { requestId: string; targetUserId: string; requesterName: string; familyId: string }) {
  const { requestId, targetUserId, requesterName } = opts
  const title = "Location ping request"
  const body = `${requesterName} is asking for your current location. Approve or deny in Togethr. Your location is shared once, only if you approve.`
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
  await Promise.all(tasks)
}

/** Tell the requester how the target responded. */
export async function notifyRequesterOutcome(requesterUserId: string, targetName: string, outcome: "APPROVED" | "DENIED") {
  const title = outcome === "APPROVED" ? "Location ping approved" : "Location ping declined"
  const body = outcome === "APPROVED" ? `${targetName} shared their location with you once. Open Togethr to see it.` : `${targetName} declined your location request.`
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

/** The request sat unanswered for the full window. */
export async function notifyRequesterExpired(requesterUserId: string, targetName: string) {
  const title = "Location ping: no response"
  const body = `${targetName} didn't respond to your location request, so it expired. You can send a new one.`
  try {
    await insertNotification(requesterUserId, title, body, { subType: "LOCATION_APPROVAL_RESULT", outcome: "EXPIRED" })
  } catch (e) {
    console.error("requester expiry in-app failed:", e)
  }
  if (isFirebaseConfigured()) {
    try {
      await sendPushToUser(requesterUserId, { title, body, data: { type: "LOCATION_APPROVAL_RESULT", outcome: "EXPIRED" }, clickAction: "/location" })
    } catch (e) {
      console.error("requester expiry push failed:", e)
    }
  }
}
