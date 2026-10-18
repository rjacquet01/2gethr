import { sql } from "./db"

// Guest members only see the events and tasks that involve them:
//  - events they created or are a participant of (event_participants.user_id)
//  - tasks they created or are assigned to
// Every other role keeps the family-wide view. These helpers filter rows that
// were already loaded with the normal query, so nothing changes for non-guests.

/** Families in which this user is an active GUEST. */
export async function getGuestFamilyIds(userId: string): Promise<string[]> {
  const rows = await sql`
    SELECT family_id FROM family_members
    WHERE user_id = ${userId} AND is_active = true AND role = 'GUEST'
  `
  return rows.map((r) => r.family_id as string)
}

/**
 * For SQL that is scoped to one family: the user's id when they are a GUEST
 * there, else null. Use as
 *   AND (${g}::text IS NULL OR <row involves ${g}>)
 * so non-guests get exactly the old query.
 */
export async function guestScopeUserId(familyId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const rows = await sql`
    SELECT 1 FROM family_members
    WHERE family_id = ${familyId} AND user_id = ${userId} AND is_active = true AND role = 'GUEST'
    LIMIT 1
  `
  return rows.length > 0 ? userId : null
}

/** Of these event ids, the ones the user created or is a participant of. */
export async function eventIdsInvolvingUser(userId: string, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set()
  const rows = await sql`
    SELECT e.id FROM events e
    WHERE e.id = ANY(${eventIds})
      AND (
        e.created_by_id = ${userId}
        OR EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = e.id AND ep.user_id = ${userId})
      )
  `
  return new Set(rows.map((r) => r.id as string))
}

/**
 * Event visibility for everyone (not just guests): FAMILY events are shared;
 * PRIVATE events only with their creator; SELECTED_MEMBERS events with their
 * creator and participants. Rows without a visibility value count as FAMILY.
 */
export async function filterEventsByVisibility<T extends { id: string; visibility?: unknown; created_by_id?: unknown }>(
  rows: T[],
  userId: string
): Promise<T[]> {
  const restricted = rows.filter((r) => r.visibility && r.visibility !== "FAMILY" && r.created_by_id !== userId)
  if (restricted.length === 0) return rows
  const selected = restricted.filter((r) => r.visibility === "SELECTED_MEMBERS").map((r) => r.id)
  const allowed = await eventIdsInvolvingUser(userId, selected)
  const hidden = new Set(restricted.filter((r) => !allowed.has(r.id)).map((r) => r.id))
  return rows.filter((r) => !hidden.has(r.id))
}

/** Can this user see this one event under the visibility rules above? */
export async function canSeeEventVisibility(
  event: { id: string; visibility?: unknown; created_by_id?: unknown },
  userId: string
): Promise<boolean> {
  return (await filterEventsByVisibility([event], userId)).length === 1
}

/**
 * Drop events a guest may not see. `familyOf` returns the event's family id;
 * rows from families where the user is not a guest are always kept.
 */
export async function filterEventsForGuest<T extends { id: string }>(
  rows: T[],
  userId: string,
  familyOf: (row: T) => string | null | undefined,
  guestFamilyIds?: string[]
): Promise<T[]> {
  const guestFamilies = guestFamilyIds ?? (await getGuestFamilyIds(userId))
  if (guestFamilies.length === 0) return rows
  const scoped = rows.filter((r) => guestFamilies.includes(familyOf(r) ?? ""))
  if (scoped.length === 0) return rows
  const allowed = await eventIdsInvolvingUser(userId, scoped.map((r) => r.id))
  return rows.filter((r) => !guestFamilies.includes(familyOf(r) ?? "") || allowed.has(r.id))
}

/** Can a guest see this one event? (Created it or is a participant.) */
export async function guestCanSeeEvent(userId: string, eventId: string): Promise<boolean> {
  return (await eventIdsInvolvingUser(userId, [eventId])).has(eventId)
}

type TaskLike = { created_by_id?: string | null; assigned_to_id?: string | null }

export function taskInvolvesUser(task: TaskLike, userId: string): boolean {
  return task.created_by_id === userId || task.assigned_to_id === userId
}

/**
 * Drop tasks a guest may not see. `familyOf` returns the task's family id;
 * rows from families where the user is not a guest are always kept.
 */
export async function filterTasksForGuest<T extends TaskLike>(
  rows: T[],
  userId: string,
  familyOf: (row: T) => string | null | undefined,
  guestFamilyIds?: string[]
): Promise<T[]> {
  const guestFamilies = guestFamilyIds ?? (await getGuestFamilyIds(userId))
  if (guestFamilies.length === 0) return rows
  return rows.filter((r) => !guestFamilies.includes(familyOf(r) ?? "") || taskInvolvesUser(r, userId))
}
