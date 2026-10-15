import { sql } from "./db"
import { createNotification, type NotificationType } from "./notifications"
import { sendPushToUser, isFirebaseConfigured } from "./services/push"
import { isQuietNow } from "./quiet-hours"

// Event comments and the family board: short text only. Every list query is
// LIMITed with a created_at cursor and served by an index on these tables.

export const EVENT_COMMENT_MAX = 500
export const POST_MAX = 500
export const POST_COMMENT_MAX = 300
export const PAGE_SIZE_COMMENTS = 50
export const PAGE_SIZE_POSTS = 20
export const RATE_LIMIT_PER_MINUTE = 10
export const PUSH_COALESCE_MINUTES = 10

let ensured: Promise<void> | null = null
/** Lazy idempotent schema (scripts/run-social-migration.mjs adds the same up front). */
export function ensureSocialTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS event_comments (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          family_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_event_comments_event ON event_comments(event_id, created_at)`
      await sql`CREATE INDEX IF NOT EXISTS idx_event_comments_user ON event_comments(user_id, created_at)`
      await sql`
        CREATE TABLE IF NOT EXISTS family_posts (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          body TEXT NOT NULL,
          pinned BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_family_posts_family ON family_posts(family_id, created_at DESC)`
      await sql`CREATE INDEX IF NOT EXISTS idx_family_posts_user ON family_posts(user_id, created_at)`
      await sql`
        CREATE TABLE IF NOT EXISTS family_post_comments (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          family_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_family_post_comments_post ON family_post_comments(post_id, created_at)`
      await sql`CREATE INDEX IF NOT EXISTS idx_family_post_comments_user ON family_post_comments(user_id, created_at)`
      // One row per (recipient, thread): when they last got a push for it.
      await sql`
        CREATE TABLE IF NOT EXISTS social_push_log (
          user_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          last_push_at TIMESTAMPTZ NOT NULL,
          PRIMARY KEY (user_id, scope)
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_social_push_log_time ON social_push_log(last_push_at)`
      await sql`ALTER TABLE family_members ADD COLUMN IF NOT EXISTS board_last_seen_at TIMESTAMPTZ`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

/** Trimmed text, or an error message if it is empty or too long. */
export function cleanBody(raw: unknown, max: number): { body: string } | { error: string } {
  const body = typeof raw === "string" ? raw.trim() : ""
  if (!body) return { error: "Write something first" }
  if (body.length > max) return { error: `Keep it to ${max} characters` }
  return { body }
}

/** Parse a ?before= / ?since= cursor; null if absent or not a date. */
export function parseCursor(v: string | null): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Comments + posts + post comments this user wrote in the last minute, by table. */
export async function overRateLimit(userId: string, kind: "event_comment" | "board"): Promise<boolean> {
  const rows =
    kind === "event_comment"
      ? await sql`
          SELECT COUNT(*)::int AS n FROM event_comments
          WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '1 minute'
        `
      : await sql`
          SELECT
            (SELECT COUNT(*) FROM family_posts WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '1 minute')
            + (SELECT COUNT(*) FROM family_post_comments WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '1 minute') AS n
        `
  return Number(rows[0].n) >= RATE_LIMIT_PER_MINUTE
}

export const RATE_LIMIT_MESSAGE = "You're posting a lot - wait a minute and try again"

export interface AuthorInfo {
  authorName: string
  avatarUrl: string | null
  color: string | null
  emoji: string | null
}

/** Display name / avatar / colour for each author, as seen in this family. */
export async function authorInfo(familyId: string, userIds: string[]): Promise<Map<string, AuthorInfo>> {
  const map = new Map<string, AuthorInfo>()
  const ids = Array.from(new Set(userIds))
  if (ids.length === 0) return map
  const rows = await sql`
    SELECT u.id, u.first_name, u.last_name, u.profile_photo_path, fm.nickname, fm.color, fm.emoji
    FROM users u
    LEFT JOIN family_members fm ON fm.user_id = u.id AND fm.family_id = ${familyId}
    WHERE u.id = ANY(${ids})
  `
  for (const r of rows) {
    map.set(r.id as string, {
      authorName: `${r.first_name || ""} ${r.last_name || ""}`.trim() || (r.nickname as string) || "Family member",
      avatarUrl: (r.profile_photo_path as string) || null,
      color: (r.color as string) || null,
      emoji: (r.emoji as string) || null,
    })
  }
  return map
}

/**
 * In-app notification for every recipient; a push only when `push` is true,
 * the recipient allows push, it isn't their quiet hours, and they haven't had
 * a push for this same `scope` in the last PUSH_COALESCE_MINUTES.
 */
export async function notifySocial(opts: {
  recipientIds: string[]
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown>
  push: boolean
  scope: string
  clickAction: string
}) {
  const recipients = Array.from(new Set(opts.recipientIds))
  for (const uid of recipients) {
    try {
      await createNotification({ userId: uid, type: opts.type, title: opts.title, body: opts.body, data: opts.data, channels: ["in_app"] })
    } catch (e) {
      console.error("social in-app notify failed:", e)
    }
  }
  if (!opts.push || !isFirebaseConfigured() || recipients.length === 0) return

  const prefs = await sql`
    SELECT u.id, u.timezone, rs.push_enabled, rs.quiet_hours_start, rs.quiet_hours_end
    FROM users u LEFT JOIN reminder_settings rs ON rs.user_id = u.id
    WHERE u.id = ANY(${recipients})
  `
  for (const p of prefs) {
    if (p.push_enabled === false) continue
    if (isQuietNow(p.quiet_hours_start, p.quiet_hours_end, p.timezone)) continue
    // Claim the push slot: only one push per recipient per scope per window.
    const claimed = await sql`
      INSERT INTO social_push_log (user_id, scope, last_push_at)
      VALUES (${p.id}, ${opts.scope}, NOW())
      ON CONFLICT (user_id, scope) DO UPDATE SET last_push_at = NOW()
        WHERE social_push_log.last_push_at <= NOW() - make_interval(mins => ${PUSH_COALESCE_MINUTES}::int)
      RETURNING user_id
    `
    if (claimed.length === 0) continue
    try {
      const pushData: Record<string, string> = { type: opts.type }
      for (const [k, v] of Object.entries(opts.data)) if (v !== undefined && v !== null) pushData[k] = String(v)
      await sendPushToUser(p.id as string, { title: opts.title, body: opts.body, data: pushData, clickAction: opts.clickAction })
    } catch (e) {
      console.error("social push failed (non-fatal):", e)
    }
  }
}
