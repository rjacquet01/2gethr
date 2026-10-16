import { sql } from "./db"

// "Online" = the app was open and visible recently. The client sends a
// heartbeat every couple of minutes while visible; we store at most one write
// per user per minute in users.last_active_at.
export const ONLINE_WINDOW_SECONDS = 5 * 60
export const HEARTBEAT_MIN_GAP_SECONDS = 60

let ensured: Promise<void> | null = null
export function ensurePresenceColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

/** Mark the user active now (skipped if they were marked in the last minute). */
export async function touchPresence(userId: string): Promise<void> {
  await ensurePresenceColumn()
  await sql`
    UPDATE users SET last_active_at = NOW()
    WHERE id = ${userId}
      AND (last_active_at IS NULL OR last_active_at < NOW() - make_interval(secs => ${HEARTBEAT_MIN_GAP_SECONDS}::int))
  `
}
