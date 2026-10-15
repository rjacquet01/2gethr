import { sql } from "./db"
import { guestCanSeeEvent } from "./guest-scope"

export interface EventAccess {
  eventId: string
  familyId: string
  title: string
  createdById: string
  role: string
  isOwner: boolean
}

/**
 * The caller's access to an event's comments: an active member of the event's
 * family who can see the event (a guest only reaches events they created or
 * were invited to). null means "not found" to the caller.
 */
export async function eventCommentAccess(eventId: string, userId: string): Promise<EventAccess | null> {
  const rows = await sql`
    SELECT e.id, e.title, e.created_by_id, c.family_id, fm.role, (f.owner_id = ${userId}) AS is_owner
    FROM events e
    JOIN calendars c ON c.id = e.calendar_id
    JOIN families f ON f.id = c.family_id
    JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ${userId} AND fm.is_active = true
    WHERE e.id = ${eventId}
    LIMIT 1
  `
  const r = rows[0]
  if (!r) return null
  if (r.role === "GUEST" && !(await guestCanSeeEvent(userId, eventId))) return null
  return {
    eventId,
    familyId: r.family_id as string,
    title: r.title as string,
    createdById: r.created_by_id as string,
    role: r.role as string,
    isOwner: r.is_owner === true,
  }
}
