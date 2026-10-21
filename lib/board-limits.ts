import type { NeonQueryPromise } from "@neondatabase/serverless"
import { sql } from "./db"
import { ddl } from "./schema-snapshot"
import { BOARD_LIMITS } from "./constants"
import { ensureBoardFlyerColumns, flyerImageUrl } from "./board-flyers"
import { getParts, isValidTimeZone, zonedToUtc } from "./recurrence"
import { authorInfo } from "./social"

// How full the family board may get, and what comes down to make room.
//
// A pin is VISIBLE when it isn't deleted, isn't taken down, and isn't an
// event flyer past its date (expires_at before the start of today in the
// family's time zone) unless it is kept up. Every board read applies that
// rule itself, so expiry works even if no cron runs:
//
//   taken_down_at IS NULL AND (keep_up OR expires_at IS NULL OR expires_at >= <cutoff>)
//
// Posting or restoring at a limit takes down the oldest visible pin that
// isn't kept up (placePin). Taken down is a soft delete: an adult can restore
// it for RESTORE_DAYS, then purgeBoardPosts() deletes it with its files.

export type TakeDownReason = "roll_off" | "event_over" | "manual"

let ensured: Promise<void> | null = null

/** Lazy idempotent schema (scripts/add-board-limits.sql adds the same up front). */
export function ensureBoardLimitColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ensureBoardFlyerColumns()
      await ddl`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS taken_down_at TIMESTAMPTZ`
      await ddl`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS taken_down_reason TEXT`
      await ddl`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS keep_up BOOLEAN NOT NULL DEFAULT false`
      await ddl`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`
      await ddl`CREATE INDEX IF NOT EXISTS idx_family_posts_taken_down ON family_posts(family_id, taken_down_at)`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

const FALLBACK_TZ = "America/New_York"

/** The family's time zone: the owner's, or Eastern when unset or invalid. */
export async function familyTimeZone(familyId: string): Promise<string> {
  const rows = await sql`
    SELECT u.timezone FROM families f JOIN users u ON u.id = f.owner_id WHERE f.id = ${familyId} LIMIT 1
  `
  const tz = rows[0]?.timezone as string | null | undefined
  return isValidTimeZone(tz) ? tz : FALLBACK_TZ
}

/** Midnight at the start of `now`'s day in `tz`, as an instant. */
export function startOfDay(tz: string, now: Date = new Date()): Date {
  const p = getParts(now, tz)
  return zonedToUtc(p.y, p.mo, p.d, 0, 0, 0, tz)
}

/** An event flyer whose expires_at is before this instant is no longer shown. */
export async function expiryCutoff(familyId: string): Promise<string> {
  return startOfDay(await familyTimeZone(familyId)).toISOString()
}

/**
 * "Take this down after" a YYYY-MM-DD date: stored as the start of that day
 * in the family's time zone, so the flyer shows through that day and comes
 * down the day after. Null for a malformed date; `past` when it's before today.
 */
export async function expiryFromDate(
  familyId: string,
  date: string
): Promise<{ expiresAt: string; past: boolean } | null> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  const tz = await familyTimeZone(familyId)
  const at = zonedToUtc(y, mo, d, 0, 0, 0, tz)
  return { expiresAt: at.toISOString(), past: at.getTime() < startOfDay(tz).getTime() }
}

/** The same visibility rule as the SQL above, for a row already loaded. */
export function isVisibleRow(
  r: { taken_down_at?: unknown; keep_up?: unknown; expires_at?: unknown },
  cutoff: string
): boolean {
  if (r.taken_down_at) return false
  if (r.keep_up === true || !r.expires_at) return true
  return new Date(r.expires_at as string).getTime() >= new Date(cutoff).getTime()
}

export interface RolledOff {
  id: string
  title: string
}

function pinTitle(body: unknown, isFlyer: boolean): string {
  const line = String(body || "").trim().split("\n")[0].trim()
  if (!line) return isFlyer ? "A flyer" : "A note"
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

// One per-family lock for everything that changes what's on the board, so
// concurrent posts, restores and keep-up changes run one at a time.
const lockFor = (familyId: string) => sql`SELECT pg_advisory_xact_lock(hashtext(${`board-pins:${familyId}`}))`

/**
 * Put a pin on the board and take down whatever must come down to keep the
 * family within MAX_FLYERS flyers and MAX_PINS pins. `place` is the INSERT
 * (new post) or UPDATE (restore) of pin `postId`; it runs in one transaction
 * with the take-down, under the family lock, so concurrent posts can never
 * leave more than MAX_PINS visible or take down more than needed. The pin
 * being placed and kept-up pins are never taken down. If `place` changes no
 * row nothing is taken down.
 */
export async function placePin(
  familyId: string,
  postId: string,
  place: NeonQueryPromise<false, false>
): Promise<{ rows: Record<string, unknown>[]; rolledOff: RolledOff[] }> {
  await ensureBoardLimitColumns()
  const cutoff = await expiryCutoff(familyId)
  const [, placed, off] = await sql.transaction([
    lockFor(familyId),
    place,
    sql`
      WITH vis AS (
        SELECT id, created_at, keep_up, flyer_full_path IS NOT NULL AS is_flyer
        FROM family_posts
        WHERE family_id = ${familyId} AND deleted_at IS NULL AND taken_down_at IS NULL
          AND (keep_up OR expires_at IS NULL OR expires_at >= ${cutoff}::timestamptz)
      ),
      n AS (
        SELECT count(*)::int AS total, (count(*) FILTER (WHERE is_flyer))::int AS flyers FROM vis
      ),
      fly AS (
        SELECT id FROM vis
        WHERE is_flyer AND NOT keep_up AND id <> ${postId}
          AND EXISTS (SELECT 1 FROM vis WHERE id = ${postId})
        ORDER BY created_at, id
        LIMIT GREATEST((SELECT flyers FROM n) - ${BOARD_LIMITS.MAX_FLYERS}, 0)
      ),
      other AS (
        SELECT id FROM vis
        WHERE NOT keep_up AND id <> ${postId} AND id NOT IN (SELECT id FROM fly)
          AND EXISTS (SELECT 1 FROM vis WHERE id = ${postId})
        ORDER BY created_at, id
        LIMIT GREATEST((SELECT total FROM n) - (SELECT count(*)::int FROM fly) - ${BOARD_LIMITS.MAX_PINS}, 0)
      )
      UPDATE family_posts SET taken_down_at = NOW(), taken_down_reason = 'roll_off'
      WHERE id IN (SELECT id FROM fly UNION ALL SELECT id FROM other) AND taken_down_at IS NULL
      RETURNING id, body, created_at, flyer_full_path IS NOT NULL AS is_flyer
    `,
  ])
  const rolledOff = (off as Record<string, unknown>[])
    .sort((a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime())
    .map((r) => ({ id: r.id as string, title: pinTitle(r.body, r.is_flyer === true) }))
  return { rows: placed as Record<string, unknown>[], rolledOff }
}

export interface BoardCounts {
  /** visible pins (flyers + notes) */
  pins: number
  flyers: number
  keptUp: number
  /** taken down and still restorable */
  takenDown: number
}

export async function boardCounts(familyId: string, cutoff: string): Promise<BoardCounts> {
  const r = await sql`
    SELECT
      count(*) FILTER (WHERE taken_down_at IS NULL AND (keep_up OR expires_at IS NULL OR expires_at >= ${cutoff}::timestamptz))::int AS pins,
      count(*) FILTER (WHERE taken_down_at IS NULL AND (keep_up OR expires_at IS NULL OR expires_at >= ${cutoff}::timestamptz)
                         AND flyer_full_path IS NOT NULL)::int AS flyers,
      count(*) FILTER (WHERE taken_down_at IS NULL AND keep_up)::int AS kept_up,
      count(*) FILTER (WHERE (taken_down_at IS NOT NULL OR (NOT keep_up AND expires_at < ${cutoff}::timestamptz))
                         AND COALESCE(taken_down_at, expires_at + INTERVAL '1 day') > NOW() - make_interval(days => ${BOARD_LIMITS.RESTORE_DAYS}::int))::int AS taken_down
    FROM family_posts
    WHERE family_id = ${familyId} AND deleted_at IS NULL
  `
  return {
    pins: Number(r[0]?.pins ?? 0),
    flyers: Number(r[0]?.flyers ?? 0),
    keptUp: Number(r[0]?.kept_up ?? 0),
    takenDown: Number(r[0]?.taken_down ?? 0),
  }
}

export const KEEP_UP_LIMIT_MESSAGE = `You can keep up to ${BOARD_LIMITS.MAX_KEEP_UP} pins up. Turn off Keep up on another pin first.`

/**
 * Mark a visible pin Keep up (or clear it). At most MAX_KEEP_UP per family,
 * checked under the family lock so two adults can't both take the last slot.
 */
export async function setKeepUp(
  familyId: string,
  postId: string,
  keepUp: boolean
): Promise<{ keepUp: boolean; keptUp: number } | { error: string; status: number }> {
  await ensureBoardLimitColumns()
  const cutoff = await expiryCutoff(familyId)
  const [, updated, count] = await sql.transaction([
    lockFor(familyId),
    sql`
      UPDATE family_posts SET keep_up = ${keepUp}
      WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL AND taken_down_at IS NULL
        AND (keep_up OR expires_at IS NULL OR expires_at >= ${cutoff}::timestamptz)
        AND (${!keepUp} OR keep_up OR (
          SELECT count(*) FROM family_posts
          WHERE family_id = ${familyId} AND keep_up AND deleted_at IS NULL AND taken_down_at IS NULL
        ) < ${BOARD_LIMITS.MAX_KEEP_UP})
      RETURNING id
    `,
    sql`
      SELECT count(*)::int AS n FROM family_posts
      WHERE family_id = ${familyId} AND keep_up AND deleted_at IS NULL AND taken_down_at IS NULL
    `,
  ])
  const keptUp = Number((count as Record<string, unknown>[])[0]?.n ?? 0)
  if ((updated as unknown[]).length > 0) return { keepUp, keptUp }
  const exists = await sql`
    SELECT taken_down_at, keep_up, expires_at FROM family_posts
    WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL LIMIT 1
  `
  if (!exists[0] || !isVisibleRow(exists[0], cutoff)) {
    return { error: "That pin isn't on the board", status: 404 }
  }
  return { error: KEEP_UP_LIMIT_MESSAGE, status: 400 }
}

/**
 * Put a taken-down pin back up (within RESTORE_DAYS). A board that is full
 * takes down its oldest unprotected pin instead, through placePin. An event
 * flyer past its date comes back with its date cleared.
 */
export async function restorePin(
  familyId: string,
  postId: string
): Promise<{ rows: Record<string, unknown>[]; rolledOff: RolledOff[] } | { error: string; status: number }> {
  await ensureBoardLimitColumns()
  const cutoff = await expiryCutoff(familyId)
  const result = await placePin(
    familyId,
    postId,
    sql`
      UPDATE family_posts SET taken_down_at = NULL, taken_down_reason = NULL,
        expires_at = CASE WHEN expires_at < ${cutoff}::timestamptz THEN NULL ELSE expires_at END
      WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL
        AND (taken_down_at IS NOT NULL OR (NOT keep_up AND expires_at < ${cutoff}::timestamptz))
        AND COALESCE(taken_down_at, expires_at + INTERVAL '1 day') > NOW() - make_interval(days => ${BOARD_LIMITS.RESTORE_DAYS}::int)
      RETURNING id
    `
  )
  if (result.rows.length > 0) return result
  const row = await sql`
    SELECT taken_down_at, keep_up, expires_at FROM family_posts
    WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL LIMIT 1
  `
  if (!row[0]) return { error: "That pin is gone", status: 404 }
  if (isVisibleRow(row[0], cutoff)) return { error: "That pin is already on the board", status: 409 }
  return { error: `Pins can only be restored for ${BOARD_LIMITS.RESTORE_DAYS} days`, status: 410 }
}

export interface TakenDownPin {
  id: string
  userId: string
  authorName: string
  body: string
  createdAt: unknown
  takenDownAt: string
  reason: TakeDownReason
  restoreUntil: string
  daysLeft: number
  flyer: { thumbUrl: string; width: number | null; height: number | null } | null
}

/** Restorable taken-down pins, most recent first (adults only; the route checks). */
export async function listTakenDown(familyId: string): Promise<TakenDownPin[]> {
  await ensureBoardLimitColumns()
  const cutoff = await expiryCutoff(familyId)
  const rows = await sql`
    SELECT id, user_id, body, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at,
      COALESCE(taken_down_at, expires_at + INTERVAL '1 day') AS down_at,
      COALESCE(taken_down_reason, 'event_over') AS reason
    FROM family_posts
    WHERE family_id = ${familyId} AND deleted_at IS NULL
      AND (taken_down_at IS NOT NULL OR (NOT keep_up AND expires_at < ${cutoff}::timestamptz))
      AND COALESCE(taken_down_at, expires_at + INTERVAL '1 day') > NOW() - make_interval(days => ${BOARD_LIMITS.RESTORE_DAYS}::int)
    ORDER BY down_at DESC
    LIMIT 100
  `
  const authors = await authorInfo(familyId, rows.map((r) => r.user_id as string))
  const dayMs = 86_400_000
  return rows.map((r) => {
    const down = new Date(r.down_at as string)
    const until = new Date(down.getTime() + BOARD_LIMITS.RESTORE_DAYS * dayMs)
    return {
      id: r.id as string,
      userId: r.user_id as string,
      authorName: authors.get(r.user_id as string)?.authorName || "Family member",
      body: r.body as string,
      createdAt: r.created_at,
      takenDownAt: down.toISOString(),
      reason: r.reason as TakeDownReason,
      restoreUntil: until.toISOString(),
      daysLeft: Math.max(0, Math.ceil((until.getTime() - Date.now()) / dayMs)),
      flyer: r.flyer_thumb_path
        ? {
            thumbUrl: flyerImageUrl(familyId, r.id as string, "thumb", r.flyer_uploaded_at),
            width: (r.flyer_width as number | null) ?? null,
            height: (r.flyer_height as number | null) ?? null,
          }
        : null,
    }
  })
}

/**
 * Cron: record event flyers past their date as taken down ('event_over') so
 * they show in the Taken down list and are purged on schedule. Reads already
 * hide them; this only makes it official. Kept-up pins are skipped.
 */
export async function markExpiredPins({ familyIds }: { familyIds?: string[] } = {}): Promise<number> {
  await ensureBoardLimitColumns()
  const scoped = Array.isArray(familyIds)
  const scope = familyIds ?? []
  // expires_at < NOW() is implied by expires_at < any family's cutoff.
  const fams = await sql`
    SELECT DISTINCT family_id FROM family_posts
    WHERE deleted_at IS NULL AND taken_down_at IS NULL AND NOT keep_up AND expires_at < NOW()
      AND (${!scoped} OR family_id = ANY(${scope}::text[]))
  `
  let marked = 0
  for (const f of fams) {
    const familyId = f.family_id as string
    const cutoff = await expiryCutoff(familyId)
    const r = await sql`
      UPDATE family_posts
      SET taken_down_at = LEAST(NOW(), expires_at + INTERVAL '1 day'), taken_down_reason = 'event_over'
      WHERE family_id = ${familyId} AND deleted_at IS NULL AND taken_down_at IS NULL AND NOT keep_up
        AND expires_at < ${cutoff}::timestamptz
      RETURNING id
    `
    marked += r.length
  }
  return marked
}
