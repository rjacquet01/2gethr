import { sql } from "./db"
import { ensureLegalTables } from "./legal"

// Stored-history cap for every plan. Archived tasks, events and reminders,
// board posts and comments older than this are deleted for good (location
// pings and geofence events have the same cap via LOCATION_RETENTION_DAYS in
// app/api/cron/legal-retention). Data covered by an open/approved legal case
// or a preservation hold (legal_cases.preserve_until) is never touched.
export const HISTORY_CAP_DAYS = 90

// Safety switch for the new hard deletes (archived purge, 90-day comment
// cleanup). While false, the crons only COUNT what they would delete and
// comments keep the previous 365-day age limit. Flip to true once the
// counts have been reviewed.
export const HISTORY_PURGE_ENABLED = false

/** Most items handled per run, so one cron call stays well inside its time limit. */
const MAX_PER_RUN = 5000

export interface PurgeCounts {
  tasks: number
  taskHistory: number
  taskComments: number
  syncedTasks: number
  events: number
  eventParticipants: number
  eventRequests: number
  syncedEvents: number
  eventComments: number
  reminders: number
  syncedReminders: number
  favorites: number
  /** archived events kept because a newer, non-purged event still points at them */
  eventsKeptAsParents: number
}

/** Users and families under an open/approved legal case or a preservation hold. */
async function heldScope(): Promise<{ users: string[]; families: string[] }> {
  // Any failure here throws and stops the purge: never delete without
  // knowing what is held.
  await ensureLegalTables()
  {
    const rows = await sql`
      SELECT c.scope_user_id AS user_id, c.scope_family_id AS family_id
      FROM legal_cases c
      WHERE c.status IN ('OPEN', 'APPROVED') OR c.preserve_until > NOW()
    `
    const users = new Set<string>()
    const families = new Set<string>()
    for (const r of rows) {
      if (r.user_id) users.add(r.user_id as string)
      if (r.family_id) families.add(r.family_id as string)
    }
    if (families.size > 0) {
      // Everyone in a held family is held too (matches the legal-retention cron).
      const members = await sql`
        SELECT DISTINCT user_id FROM family_members
        WHERE family_id = ANY(${Array.from(families)}::text[]) AND user_id IS NOT NULL
      `
      for (const m of members) users.add(m.user_id as string)
    }
    return { users: Array.from(users), families: Array.from(families) }
  }
}

/**
 * Archived items past the cap that may be deleted (holds excluded), plus the
 * rows that reference them. With dryRun nothing is changed.
 */
export async function purgeArchivedHistory({ dryRun }: { dryRun: boolean }): Promise<PurgeCounts> {
  const held = await heldScope()
  const cap = HISTORY_CAP_DAYS

  const taskIds = (await sql`
    SELECT t.id FROM tasks t
    WHERE t.status = 'ARCHIVED'
      AND t.updated_at < NOW() - make_interval(days => ${cap}::int)
      AND NOT (t.family_id = ANY(${held.families}::text[]))
      AND NOT (COALESCE(t.created_by_id, '') = ANY(${held.users}::text[]))
      AND NOT (COALESCE(t.assigned_to_id, '') = ANY(${held.users}::text[]))
    LIMIT ${MAX_PER_RUN}
  `).map((r) => r.id as string)

  let eventIds = (await sql`
    SELECT e.id FROM events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE e.status = 'ARCHIVED'
      AND e.end_time < NOW() - make_interval(days => ${cap}::int)
      AND NOT (c.family_id = ANY(${held.families}::text[]))
      AND NOT (COALESCE(e.created_by_id, '') = ANY(${held.users}::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM event_participants ep
        WHERE ep.event_id = e.id AND ep.user_id = ANY(${held.users}::text[])
      )
    LIMIT ${MAX_PER_RUN}
  `).map((r) => r.id as string)
  // events.parent_event_id has no ON DELETE action: an event can only go if
  // every event pointing at it goes in the same statement. Drop parents
  // whose children stay, repeating until stable (a parent can be a child).
  const before = eventIds.length
  for (;;) {
    if (eventIds.length === 0) break
    const keep = new Set(eventIds)
    const children = await sql`
      SELECT id, parent_event_id FROM events WHERE parent_event_id = ANY(${eventIds}::text[])
    `
    const blocked = new Set(children.filter((c) => !keep.has(c.id as string)).map((c) => c.parent_event_id as string))
    if (blocked.size === 0) break
    eventIds = eventIds.filter((id) => !blocked.has(id))
  }
  const eventsKeptAsParents = before - eventIds.length

  const reminderIds = (await sql`
    SELECT r.id FROM reminders r
    WHERE r.status = 'ARCHIVED'
      AND r.updated_at < NOW() - make_interval(days => ${cap}::int)
      AND NOT (COALESCE(r.family_id, '') = ANY(${held.families}::text[]))
      AND NOT (COALESCE(r.user_id, '') = ANY(${held.users}::text[]))
      AND NOT (COALESCE(r.created_by_id, '') = ANY(${held.users}::text[]))
    LIMIT ${MAX_PER_RUN}
  `).map((r) => r.id as string)

  const count = async (q: Promise<Record<string, unknown>[]>) => Number((await q)[0]?.n ?? 0)
  const counts: PurgeCounts = {
    tasks: taskIds.length,
    taskHistory: await count(sql`SELECT count(*)::int AS n FROM task_history WHERE task_id = ANY(${taskIds}::text[])`),
    taskComments: await count(sql`SELECT count(*)::int AS n FROM task_comments WHERE task_id = ANY(${taskIds}::text[])`),
    syncedTasks: await count(sql`SELECT count(*)::int AS n FROM synced_tasks WHERE familyhub_task_id = ANY(${taskIds}::text[])`),
    events: eventIds.length,
    eventParticipants: await count(sql`SELECT count(*)::int AS n FROM event_participants WHERE event_id = ANY(${eventIds}::text[])`),
    eventRequests: await count(sql`SELECT count(*)::int AS n FROM event_requests WHERE event_id = ANY(${eventIds}::text[])`),
    syncedEvents: await count(sql`SELECT count(*)::int AS n FROM synced_events WHERE local_event_id = ANY(${eventIds}::text[])`),
    eventComments: await count(sql`SELECT count(*)::int AS n FROM event_comments WHERE event_id = ANY(${eventIds}::text[])`),
    reminders: reminderIds.length,
    syncedReminders: await count(sql`SELECT count(*)::int AS n FROM synced_reminders WHERE reminder_id = ANY(${reminderIds}::text[])`),
    favorites: await count(sql`
      SELECT count(*)::int AS n FROM user_favorites
      WHERE (item_type = 'task' AND item_id = ANY(${taskIds}::text[]))
         OR (item_type = 'event' AND item_id = ANY(${eventIds}::text[]))
         OR (item_type = 'reminder' AND item_id = ANY(${reminderIds}::text[]))
    `),
    eventsKeptAsParents,
  }
  if (dryRun) return counts

  // Rows that reference these without a foreign key go first; task_history,
  // task_comments, event_participants, event_requests and synced_events
  // cascade from their parent row.
  if (taskIds.length > 0) {
    await sql`DELETE FROM synced_tasks WHERE familyhub_task_id = ANY(${taskIds}::text[])`
    await sql`DELETE FROM user_favorites WHERE item_type = 'task' AND item_id = ANY(${taskIds}::text[])`
    await sql`DELETE FROM tasks WHERE id = ANY(${taskIds}::text[])`
  }
  if (eventIds.length > 0) {
    await sql`DELETE FROM event_comments WHERE event_id = ANY(${eventIds}::text[])`
    await sql`DELETE FROM user_favorites WHERE item_type = 'event' AND item_id = ANY(${eventIds}::text[])`
    await sql`DELETE FROM events WHERE id = ANY(${eventIds}::text[])`
  }
  if (reminderIds.length > 0) {
    await sql`DELETE FROM synced_reminders WHERE reminder_id = ANY(${reminderIds}::text[])`
    await sql`DELETE FROM user_favorites WHERE item_type = 'reminder' AND item_id = ANY(${reminderIds}::text[])`
    await sql`DELETE FROM reminders WHERE id = ANY(${reminderIds}::text[])`
  }
  return counts
}

/** Users whose board posts/comments must be kept (open legal case or hold). */
export async function heldUserIds(): Promise<string[]> {
  return (await heldScope()).users
}
export async function heldFamilyIds(): Promise<string[]> {
  return (await heldScope()).families
}
