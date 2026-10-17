import { sql } from "./db"
import { ensureLegalTables } from "./legal"

// Stored-history cap for every plan. Archived tasks, events and reminders,
// board posts and comments older than this are deleted for good (location
// pings and geofence events have the same cap via LOCATION_RETENTION_DAYS in
// app/api/cron/legal-retention). Data covered by an open/approved legal case
// or a preservation hold (legal_cases.preserve_until) is never touched.
export const HISTORY_CAP_DAYS = 90

/**
 * The purge is ON. Setting RETENTION_PURGE_DISABLED=true (Vercel env var)
 * stops it at once without a deploy: the crons then only report what they
 * would delete, and comments fall back to the old 365-day limit.
 */
export function isHistoryPurgeEnabled(): boolean {
  return process.env.RETENTION_PURGE_DISABLED !== "true"
}

/**
 * Safety cap: at most this many rows are deleted from any one table in one
 * run, counting rows removed by ON DELETE CASCADE. A bad cutoff can then never
 * empty a table in one night; whatever is left goes on the next run.
 */
export const MAX_ROWS_PER_TABLE = 5000
const MAX_ROWS_PER_TABLE_LIMIT = MAX_ROWS_PER_TABLE // a caller can lower the cap, never raise it

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
  /** some eligible rows were left for the next run because a table hit MAX_ROWS_PER_TABLE */
  capped: boolean
}

/** Users and families under an open/approved legal case or a preservation hold. */
async function heldScope(): Promise<{ users: string[]; families: string[] }> {
  // Any failure here throws and stops the purge: never delete without
  // knowing what is held.
  await ensureLegalTables()
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

/** Per-parent child row counts: Map(parentId -> {table: n}). */
async function childCounts(
  rows: Record<string, unknown>[]
): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const id = r.parent_id as string
    const cur = out.get(id) || {}
    cur[r.tbl as string] = (cur[r.tbl as string] || 0) + Number(r.n)
    out.set(id, cur)
  }
  return out
}

/**
 * Archived items past the cap that may be deleted (holds excluded), plus the
 * rows that reference them. With dryRun nothing is changed. `familyIds`
 * restricts the run to those families (used by the test only).
 */
export async function purgeArchivedHistory({
  dryRun,
  familyIds,
  maxRowsPerTable = MAX_ROWS_PER_TABLE,
}: {
  dryRun: boolean
  familyIds?: string[]
  /** test hook; production always uses MAX_ROWS_PER_TABLE */
  maxRowsPerTable?: number
}): Promise<PurgeCounts> {
  const MAX_ROWS_PER_TABLE = Math.min(maxRowsPerTable, MAX_ROWS_PER_TABLE_LIMIT)
  const held = await heldScope()
  const cap = HISTORY_CAP_DAYS
  const scoped = Array.isArray(familyIds)
  const scope = familyIds ?? []

  // Running totals per table, shared across tasks/events/reminders (favorites
  // holds all three), so no table exceeds MAX_ROWS_PER_TABLE this run.
  const totals: Record<string, number> = {}
  let capped = false
  const take = (ids: string[], parentTable: string, perParent: Map<string, Record<string, number>>) => {
    const kept: string[] = []
    for (const id of ids) {
      const need: Record<string, number> = { [parentTable]: 1, ...(perParent.get(id) || {}) }
      if (Object.entries(need).some(([t, n]) => (totals[t] || 0) + n > MAX_ROWS_PER_TABLE)) {
        capped = true
        continue
      }
      for (const [t, n] of Object.entries(need)) totals[t] = (totals[t] || 0) + n
      kept.push(id)
    }
    return kept
  }

  // --- tasks (updated_at = when archived) ---
  const taskCandidates = (await sql`
    SELECT t.id FROM tasks t
    WHERE t.status = 'ARCHIVED'
      AND t.updated_at < NOW() - make_interval(days => ${cap}::int)
      AND (${!scoped} OR t.family_id = ANY(${scope}::text[]))
      AND NOT (t.family_id = ANY(${held.families}::text[]))
      AND NOT (COALESCE(t.created_by_id, '') = ANY(${held.users}::text[]))
      AND NOT (COALESCE(t.assigned_to_id, '') = ANY(${held.users}::text[]))
    ORDER BY t.updated_at
    LIMIT ${MAX_ROWS_PER_TABLE + 1}
  `).map((r) => r.id as string)
  if (taskCandidates.length > MAX_ROWS_PER_TABLE) capped = true
  const taskChildren = await childCounts(await sql`
    SELECT task_id AS parent_id, 'task_history' AS tbl, count(*)::int AS n FROM task_history WHERE task_id = ANY(${taskCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT task_id, 'task_comments', count(*)::int FROM task_comments WHERE task_id = ANY(${taskCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT familyhub_task_id, 'synced_tasks', count(*)::int FROM synced_tasks WHERE familyhub_task_id = ANY(${taskCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT item_id, 'user_favorites', count(*)::int FROM user_favorites WHERE item_type = 'task' AND item_id = ANY(${taskCandidates}::text[]) GROUP BY 1
  `)
  const taskIds = take(taskCandidates.slice(0, MAX_ROWS_PER_TABLE), 'tasks', taskChildren)

  // --- events (end_time; archiving doesn't touch updated_at) ---
  let eventCandidates = (await sql`
    SELECT e.id FROM events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE e.status = 'ARCHIVED'
      AND e.end_time < NOW() - make_interval(days => ${cap}::int)
      AND (${!scoped} OR c.family_id = ANY(${scope}::text[]))
      AND NOT (c.family_id = ANY(${held.families}::text[]))
      AND NOT (COALESCE(e.created_by_id, '') = ANY(${held.users}::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM event_participants ep
        WHERE ep.event_id = e.id AND ep.user_id = ANY(${held.users}::text[])
      )
    ORDER BY e.end_time
    LIMIT ${MAX_ROWS_PER_TABLE + 1}
  `).map((r) => r.id as string)
  if (eventCandidates.length > MAX_ROWS_PER_TABLE) capped = true
  eventCandidates = eventCandidates.slice(0, MAX_ROWS_PER_TABLE)
  const eventChildren = await childCounts(await sql`
    SELECT event_id AS parent_id, 'event_participants' AS tbl, count(*)::int AS n FROM event_participants WHERE event_id = ANY(${eventCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT event_id, 'event_requests', count(*)::int FROM event_requests WHERE event_id = ANY(${eventCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT local_event_id, 'synced_events', count(*)::int FROM synced_events WHERE local_event_id = ANY(${eventCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT event_id, 'event_comments', count(*)::int FROM event_comments WHERE event_id = ANY(${eventCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT item_id, 'user_favorites', count(*)::int FROM user_favorites WHERE item_type = 'event' AND item_id = ANY(${eventCandidates}::text[]) GROUP BY 1
  `)
  let eventIds = take(eventCandidates, 'events', eventChildren)
  // events.parent_event_id has no ON DELETE action: an event can only go if
  // every event pointing at it goes in the same statement. Drop parents
  // whose children stay, repeating until stable (a parent can be a child).
  const beforeParents = eventIds.length
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
  const eventsKeptAsParents = beforeParents - eventIds.length

  // --- reminders (updated_at = when archived) ---
  const reminderCandidates = (await sql`
    SELECT r.id FROM reminders r
    WHERE r.status = 'ARCHIVED'
      AND r.updated_at < NOW() - make_interval(days => ${cap}::int)
      AND (${!scoped} OR r.family_id = ANY(${scope}::text[]))
      AND NOT (COALESCE(r.family_id, '') = ANY(${held.families}::text[]))
      AND NOT (COALESCE(r.user_id, '') = ANY(${held.users}::text[]))
      AND NOT (COALESCE(r.created_by_id, '') = ANY(${held.users}::text[]))
    ORDER BY r.updated_at
    LIMIT ${MAX_ROWS_PER_TABLE + 1}
  `).map((r) => r.id as string)
  if (reminderCandidates.length > MAX_ROWS_PER_TABLE) capped = true
  const reminderChildren = await childCounts(await sql`
    SELECT reminder_id AS parent_id, 'synced_reminders' AS tbl, count(*)::int AS n FROM synced_reminders WHERE reminder_id = ANY(${reminderCandidates}::text[]) GROUP BY 1
    UNION ALL SELECT item_id, 'user_favorites', count(*)::int FROM user_favorites WHERE item_type = 'reminder' AND item_id = ANY(${reminderCandidates}::text[]) GROUP BY 1
  `)
  const reminderIds = take(reminderCandidates.slice(0, MAX_ROWS_PER_TABLE), 'reminders', reminderChildren)

  const sum = (ids: string[], per: Map<string, Record<string, number>>, tbl: string) =>
    ids.reduce((a, id) => a + (per.get(id)?.[tbl] || 0), 0)
  const counts: PurgeCounts = {
    tasks: taskIds.length,
    taskHistory: sum(taskIds, taskChildren, 'task_history'),
    taskComments: sum(taskIds, taskChildren, 'task_comments'),
    syncedTasks: sum(taskIds, taskChildren, 'synced_tasks'),
    events: eventIds.length,
    eventParticipants: sum(eventIds, eventChildren, 'event_participants'),
    eventRequests: sum(eventIds, eventChildren, 'event_requests'),
    syncedEvents: sum(eventIds, eventChildren, 'synced_events'),
    eventComments: sum(eventIds, eventChildren, 'event_comments'),
    reminders: reminderIds.length,
    syncedReminders: sum(reminderIds, reminderChildren, 'synced_reminders'),
    favorites:
      sum(taskIds, taskChildren, 'user_favorites') +
      sum(eventIds, eventChildren, 'user_favorites') +
      sum(reminderIds, reminderChildren, 'user_favorites'),
    eventsKeptAsParents,
    capped,
  }
  if (capped) {
    console.warn(`[retention] per-table cap of ${MAX_ROWS_PER_TABLE} rows reached; the rest is left for the next run`, counts)
  } else {
    console.log(`[retention] ${dryRun ? 'would delete' : 'deleting'}:`, counts)
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
