import { sql } from "./db"
import { filterEventsByVisibility } from "./guest-scope"
import { ensureSocialTables } from "./social"
import { ensureBoardLimitColumns, expiryCutoff, isVisibleRow } from "./board-limits"

// The family Activity feed: who added or changed what, and when. Read-only,
// built when the page is opened from data that is already stored:
//   - task_history (who did what to a task)
//   - events (who created it; "changed" from updated_at, with no editor named
//     because events don't record who edited them)
//   - board posts (who posted)
// Events follow the calendar's visibility rules. Nothing here writes.

export type ActivityKind = "event" | "task" | "post"

export interface ActivityItem {
  id: string
  kind: ActivityKind
  at: string
  /** Who did it; null when it isn't recorded (an event edit). */
  actor: string | null
  /** "added the event", "completed the task"... */
  verb: string
  subject: string
  /** Text after the subject ("was changed"). */
  tail: string
  href: string
  /** Same-kind additions by one person close together are folded into one line. */
  groupKey?: string
}

const GROUP_GAP_MS = 3 * 60 * 1000
const GROUP_MIN = 3

const TASK_ACTIONS = ["CREATED", "UPDATED", "COMPLETED", "SUBMITTED_FOR_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "COMMENTED"]

export function taskVerb(action: string, newValue: unknown): string | null {
  const assignment = (newValue && typeof newValue === "object" ? (newValue as Record<string, unknown>).assignment : null) as string | null
  switch (action) {
    case "CREATED": return "added the task"
    case "UPDATED": return "changed the task"
    case "COMPLETED": return "completed the task"
    case "SUBMITTED_FOR_APPROVAL": return "finished the task and sent it for approval:"
    case "APPROVED": return assignment === "accepted" ? "accepted the task" : "approved the task"
    case "REJECTED": return assignment === "declined" ? "declined the task" : "sent back the task"
    case "CANCELLED": return "cancelled the task"
    case "COMMENTED": return "commented on the task"
    default: return null
  }
}

const iso = (v: unknown) => new Date(v as string).toISOString()
const clip = (s: unknown, n = 60) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t
}

/**
 * "Mom added 12 events": three or more additions of one kind by one person
 * within a few minutes of each other (a calendar import) become one line.
 * Input newest first; output keeps that order.
 */
export function groupActivity(items: ActivityItem[]): ActivityItem[] {
  const out: ActivityItem[] = []
  let i = 0
  while (i < items.length) {
    const first = items[i]
    if (!first.groupKey) { out.push(first); i++; continue }
    let j = i + 1
    while (
      j < items.length &&
      items[j].groupKey === first.groupKey &&
      items[j].actor === first.actor &&
      new Date(items[j - 1].at).getTime() - new Date(items[j].at).getTime() <= GROUP_GAP_MS
    ) j++
    const n = j - i
    if (n >= GROUP_MIN) {
      const noun = first.groupKey === "task" ? "tasks" : "events"
      out.push({ ...first, id: `${first.id}+${n}`, verb: `added ${n} ${noun}`, subject: "", tail: "", href: first.groupKey === "task" ? "/tasks" : "/calendar", groupKey: undefined })
    } else {
      for (let k = i; k < j; k++) out.push({ ...items[k], groupKey: undefined })
    }
    i = j
  }
  return out
}

export async function loadActivity(
  familyId: string,
  userId: string,
  opts: { days: number; limit: number }
): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - opts.days * 86400000).toISOString()
  // Fetch more than we show, so folding an import into one line still leaves a full page.
  const fetchN = Math.min(opts.limit * 3, 300)

  const [taskRows, eventRows, postRows] = await Promise.all([
    sql`
      SELECT th.id, th.action, th.created_at, th.new_value, t.id AS task_id, t.title,
        CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE COALESCE(NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) END AS actor
      FROM task_history th
      JOIN tasks t ON t.id = th.task_id
      LEFT JOIN family_members fm ON fm.user_id = th.user_id AND fm.family_id = t.family_id
      LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
      LEFT JOIN users u ON u.id = th.user_id
      WHERE t.family_id = ${familyId}
        AND th.created_at >= ${since}::timestamptz
        AND th.action = ANY(${TASK_ACTIONS})
      ORDER BY th.created_at DESC
      LIMIT ${fetchN}
    `,
    sql`
      SELECT e.id, e.title, e.status, e.visibility, e.created_by_id, e.created_at, e.updated_at,
        CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE COALESCE(NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) END AS actor
      FROM events e
      JOIN calendars c ON c.id = e.calendar_id
      LEFT JOIN family_members fm ON fm.user_id = e.created_by_id AND fm.family_id = c.family_id
      LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
      LEFT JOIN users u ON u.id = e.created_by_id
      WHERE c.family_id = ${familyId}
        AND e.status != 'CANCELLED'
        AND e.parent_event_id IS NULL
        AND (e.visibility = 'FAMILY' OR e.created_by_id = ${userId} OR e.visibility = 'SELECTED_MEMBERS')
        AND (e.created_at >= ${since}::timestamptz
             OR (e.updated_at >= ${since}::timestamptz AND e.updated_at > e.created_at + interval '2 minutes'))
      ORDER BY GREATEST(e.created_at, e.updated_at) DESC
      LIMIT ${fetchN}
    `,
    (async () => {
      await ensureSocialTables()
      await ensureBoardLimitColumns()
      return sql`
        SELECT p.id, p.body, p.created_at, p.taken_down_at, p.keep_up, p.expires_at,
          (p.flyer_full_path IS NOT NULL) AS has_flyer,
          CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE COALESCE(NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) END AS actor
        FROM family_posts p
        LEFT JOIN family_members fm ON fm.user_id = p.user_id AND fm.family_id = p.family_id
        LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.family_id = ${familyId}
          AND p.deleted_at IS NULL
          AND p.created_at >= ${since}::timestamptz
        ORDER BY p.created_at DESC
        LIMIT ${fetchN}
      `
    })(),
  ])

  const items: ActivityItem[] = []

  for (const r of taskRows) {
    const verb = taskVerb(r.action as string, r.new_value)
    if (!verb) continue
    items.push({
      id: `th:${r.id}`,
      kind: "task",
      at: iso(r.created_at),
      actor: (r.actor as string | null) || "Someone",
      verb,
      subject: clip(r.title),
      tail: "",
      href: `/tasks/${r.task_id}`,
      groupKey: r.action === "CREATED" ? "task" : undefined,
    })
  }

  // PRIVATE and SELECTED_MEMBERS events only reach their creator and participants.
  const visibleEvents = await filterEventsByVisibility(
    eventRows as Array<Record<string, any> & { id: string }>,
    userId
  )
  const created = (r: Record<string, any>) => new Date(r.created_at).getTime()
  for (const r of visibleEvents) {
    if (created(r) >= new Date(since).getTime()) {
      items.push({
        id: `ev:${r.id}`,
        kind: "event",
        at: iso(r.created_at),
        actor: (r.actor as string | null) || "Someone",
        verb: r.status === "PENDING" ? "asked to add the event" : "added the event",
        subject: clip(r.title),
        tail: "",
        href: `/calendar/event/${r.id}`,
        groupKey: "event",
      })
    }
    if (new Date(r.updated_at).getTime() > created(r) + 2 * 60 * 1000 && new Date(r.updated_at).getTime() >= new Date(since).getTime()) {
      items.push({
        id: `evu:${r.id}:${new Date(r.updated_at).getTime()}`,
        kind: "event",
        at: iso(r.updated_at),
        actor: null,
        verb: "",
        subject: clip(r.title),
        tail: " was changed",
        href: `/calendar/event/${r.id}`,
      })
    }
  }

  const cutoff = await expiryCutoff(familyId)
  for (const r of postRows) {
    if (!isVisibleRow(r, cutoff)) continue
    items.push({
      id: `post:${r.id}`,
      kind: "post",
      at: iso(r.created_at),
      actor: (r.actor as string | null) || "Someone",
      verb: r.has_flyer ? "posted a flyer on the Board:" : "posted on the Board:",
      subject: clip(r.body) || "(photo)",
      tail: "",
      href: "/board",
    })
  }

  items.sort((a, b) => b.at.localeCompare(a.at))
  return groupActivity(items).slice(0, opts.limit)
}
