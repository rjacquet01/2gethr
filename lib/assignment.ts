import { sql } from "./db"
import { createNotification, notifyFamilyAboutEvent } from "./notifications"
import type { NotificationChannel } from "./notifications"

// tasks.assignment_status: NULL / ACCEPTED = active.
//   PENDING_APPROVAL   = a child assigned it to a parent/guardian (or to a
//                        child with no login): any parent/guardian must approve.
//   PENDING_ACCEPTANCE = a child assigned it to another child: that child must accept.
//   DECLINED           = refused (task is also CANCELLED).
let ensured: Promise<void> | null = null
export function ensureAssignmentColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_status TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

export const isAdultRole = (role?: string | null) => role === "PARENT" || role === "GUARDIAN"

export async function getParentUserIds(familyId: string, excludeUserId?: string): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT user_id FROM family_members
    WHERE family_id = ${familyId} AND is_active = true
      AND role IN ('PARENT', 'GUARDIAN') AND user_id IS NOT NULL
      AND user_id <> ${excludeUserId || ""}
  `
  return rows.map((r) => r.user_id as string)
}

// Event created by a child, or any event waiting on a parent.
export async function notifyEventAssignment(args: {
  familyId: string
  eventId: string
  title: string
  creatorUserId: string
  creatorName: string
  status: string
  participantUserIds: string[]
  channels?: NotificationChannel[]
}) {
  const { familyId, eventId, title, creatorUserId, creatorName, status, participantUserIds, channels } = args
  const parents = await getParentUserIds(familyId, creatorUserId)
  if (status === "PENDING") {
    for (const pid of parents) {
      await createNotification({
        userId: pid,
        type: "EVENT_APPROVAL_REQUEST",
        title: "Event needs your approval",
        body: `${creatorName} wants to add "${title}". Open it to approve or decline.`,
        data: { eventId, familyId },
        sendEmail: true,
        sendSms: true,
        channels,
      })
    }
    return
  }
  // Child-created, no parent approval needed: invited kids get an invitation
  // they must accept/decline; parents get an FYI.
  const parentSet = new Set(parents)
  for (const uid of participantUserIds) {
    if (uid === creatorUserId || parentSet.has(uid)) continue
    await createNotification({
      userId: uid,
      type: "EVENT_INVITATION",
      title: "Event invitation",
      body: `${creatorName} invited you to "${title}". Accept or decline.`,
      data: { eventId, familyId },
      sendEmail: true,
      sendSms: true,
      channels,
    })
  }
  for (const pid of parents) {
    await createNotification({
      userId: pid,
      type: "EVENT_CREATED",
      title: "New Family Event",
      body: `${creatorName} created a new event: "${title}"`,
      data: { eventId, familyId },
      sendEmail: true,
      channels,
    })
  }
}
export { notifyFamilyAboutEvent }
