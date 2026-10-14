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


// ---------------------------------------------------------------------------
// Event participants for children who have no login.
// event_participants.user_id was NOT NULL, so a child profile with no account
// could never be invited. A row now carries either user_id or child_profile_id.
// ---------------------------------------------------------------------------
let ensuredParticipants: Promise<void> | null = null
export function ensureEventParticipantChildColumns(): Promise<void> {
  if (!ensuredParticipants) {
    ensuredParticipants = (async () => {
      await sql`ALTER TABLE event_participants ALTER COLUMN user_id DROP NOT NULL`
      await sql`ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS child_profile_id TEXT`
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_event_participants_child ON event_participants(event_id, child_profile_id) WHERE child_profile_id IS NOT NULL`
    })().catch((err) => {
      ensuredParticipants = null
      throw err
    })
  }
  return ensuredParticipants
}

// Of the child profile ids asked for, keep the ones that belong to this family
// and have no login (children with a login are invited by their user id).
export async function resolveLoginlessChildIds(familyId: string, childProfileIds: string[]): Promise<string[]> {
  if (childProfileIds.length === 0) return []
  const rows = await sql`
    SELECT cp.id FROM child_profiles cp
    JOIN family_members fm ON cp.family_member_id = fm.id
    WHERE cp.id = ANY(${childProfileIds}::text[])
      AND fm.family_id = ${familyId} AND fm.is_active = true AND fm.user_id IS NULL
  `
  return rows.map((r) => r.id as string)
}

// Add people to an event (idempotent). Returns who was newly added.
export async function addEventParticipants(
  eventId: string,
  userIds: string[],
  childProfileIds: string[]
): Promise<{ addedUserIds: string[]; addedChildIds: string[] }> {
  await ensureEventParticipantChildColumns()
  let addedUserIds: string[] = []
  let addedChildIds: string[] = []
  if (userIds.length > 0) {
    const rows = await sql`
      INSERT INTO event_participants (id, event_id, user_id, status, created_at, updated_at)
      SELECT gen_random_uuid(), ${eventId}, pid, 'INVITED', NOW(), NOW()
      FROM unnest(${userIds}::text[]) AS pid
      WHERE NOT EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = ${eventId} AND ep.user_id = pid)
      RETURNING user_id
    `
    addedUserIds = rows.map((r) => r.user_id as string)
  }
  if (childProfileIds.length > 0) {
    const rows = await sql`
      INSERT INTO event_participants (id, event_id, child_profile_id, status, created_at, updated_at)
      SELECT gen_random_uuid(), ${eventId}, cid, 'ACCEPTED', NOW(), NOW()
      FROM unnest(${childProfileIds}::text[]) AS cid
      WHERE NOT EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = ${eventId} AND ep.child_profile_id = cid)
      RETURNING child_profile_id
    `
    addedChildIds = rows.map((r) => r.child_profile_id as string)
  }
  return { addedUserIds, addedChildIds }
}

// Someone was added to an event that already exists (edit page, or a calendar
// import). Same rules as creating an event:
//  - a child adding a parent/guardian or a child with no login -> the event
//    goes back to PENDING and the parents are asked to approve;
//  - otherwise each newly invited person is notified. A child invited by a
//    parent/guardian gets push + email + text + in-app.
export async function notifyParticipantsAdded(args: {
  eventId: string
  familyId: string
  title: string
  actorUserId: string
  actorName: string
  actorRole: string
  addedUserIds: string[]
  addedChildIds: string[]
  channels?: NotificationChannel[]
}): Promise<{ pending: boolean }> {
  const { eventId, familyId, title, actorUserId, actorName, actorRole, addedUserIds, addedChildIds, channels } = args
  const others = addedUserIds.filter((id) => id !== actorUserId)
  if (others.length === 0 && addedChildIds.length === 0) return { pending: false }

  const roles = others.length === 0 ? [] : await sql`
    SELECT user_id, role FROM family_members
    WHERE family_id = ${familyId} AND is_active = true AND user_id = ANY(${others}::text[])
  `
  const roleOf = new Map<string, string>(roles.map((r) => [r.user_id as string, r.role as string]))

  if (actorRole === "CHILD") {
    const needsApproval = addedChildIds.length > 0 || others.some((id) => isAdultRole(roleOf.get(id)))
    if (needsApproval) {
      await sql`UPDATE events SET status = 'PENDING', updated_at = NOW() WHERE id = ${eventId}`
      await sql`
        INSERT INTO event_requests (id, event_id, requestor_id, status, requested_at)
        VALUES (${crypto.randomUUID()}, ${eventId}, ${actorUserId}, 'PENDING', NOW())
      `
      await notifyEventAssignment({
        familyId, eventId, title, creatorUserId: actorUserId, creatorName: actorName,
        status: "PENDING", participantUserIds: others, channels,
      })
      return { pending: true }
    }
  }

  for (const uid of others) {
    const isKid = roleOf.get(uid) === "CHILD"
    const parentInvitesKid = isKid && isAdultRole(actorRole)
    await createNotification({
      userId: uid,
      type: "EVENT_INVITATION",
      title: parentInvitesKid ? "You have a new event" : "Event invitation",
      body: parentInvitesKid
        ? `${actorName} added you to "${title}"`
        : `${actorName} invited you to "${title}"${isKid ? ". Accept or decline." : ""}`,
      data: { eventId, familyId },
      ...(parentInvitesKid
        ? { channels: ["in_app", "push", "email", "sms"] as NotificationChannel[], force: true }
        : { sendEmail: true, sendSms: true, channels }),
    })
  }
  return { pending: false }
}
export { notifyFamilyAboutEvent }
