import { sql } from "./db"
import { ddl } from "./schema-snapshot"

// scripts/create-location-requests-table.sql was never run on production, so
// "Request location now" could not even store its request. Create it lazily.
let ensured: Promise<void> | null = null

export function ensureLocationRequestsTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`
        CREATE TABLE IF NOT EXISTS location_requests (
          id TEXT PRIMARY KEY,
          requester_user_id TEXT NOT NULL,
          target_user_id TEXT NOT NULL,
          family_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          fulfilled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
        )
      `
      // The original table had a CHECK limiting status; the approval flow adds
      // AWAITING_APPROVAL / DENIED / EXPIRED, so replace it with a wider one.
      // Only when it isn't already the wide one: dropping and re-adding on
      // every cold start let two instances race ("already exists" -> 500s).
      const current = await sql`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'location_requests_status_check'
      `
      const def = String(current[0]?.def ?? "")
      if (!def.includes("AWAITING_APPROVAL") || !def.includes("CANCELLED")) {
        try {
          await sql`ALTER TABLE location_requests DROP CONSTRAINT IF EXISTS location_requests_status_check`
          await sql`
            ALTER TABLE location_requests ADD CONSTRAINT location_requests_status_check
            CHECK (status IN ('AWAITING_APPROVAL', 'PENDING', 'FULFILLED', 'EXPIRED', 'DENIED', 'CANCELLED'))
          `
        } catch (err) {
          // Another instance replaced it at the same moment: that's fine.
          if (!/already exists/i.test(String((err as Error)?.message))) throw err
        }
      }
      // scripts/create-location-requests-table.sql made requester_user_id a
      // foreign key to users, but a legal request's requester is
      // "legal:<caseId>", so admin live pings failed on it. Drop only that FK
      // (target_user_id and family_id keep theirs), and only when present so
      // a cold start doesn't take a table lock for nothing.
      const requesterFk = await sql`
        SELECT 1 FROM pg_constraint WHERE conname = 'location_requests_requester_user_id_fkey'
      `
      if (requesterFk.length > 0) {
        await sql`ALTER TABLE location_requests DROP CONSTRAINT IF EXISTS location_requests_requester_user_id_fkey`
      }
      await ddl`CREATE INDEX IF NOT EXISTS idx_location_requests_target_user ON location_requests(target_user_id, status)`
      // One-time snapshot taken when the target approves, plus a flag so the
      // requester is told about an unanswered request only once.
      await ddl`ALTER TABLE location_requests ADD COLUMN IF NOT EXISTS snapshot_lat DOUBLE PRECISION`
      await ddl`ALTER TABLE location_requests ADD COLUMN IF NOT EXISTS snapshot_lng DOUBLE PRECISION`
      await ddl`ALTER TABLE location_requests ADD COLUMN IF NOT EXISTS snapshot_accuracy DOUBLE PRECISION`
      await ddl`ALTER TABLE location_requests ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ`
      await ddl`ALTER TABLE location_requests ADD COLUMN IF NOT EXISTS expiry_notified BOOLEAN NOT NULL DEFAULT false`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

/** Parent asked this user for a fresh fix and nobody has answered yet. */
export async function hasPendingLocationRequest(userId: string): Promise<boolean> {
  await ensureLocationRequestsTable()
  const rows = await sql`
    SELECT 1 FROM location_requests
    WHERE target_user_id = ${userId} AND status = 'PENDING' AND expires_at > NOW()
    LIMIT 1
  `
  return rows.length > 0
}

/** A fresh fix arrived: every open request for this user has been answered. */
export async function fulfillLocationRequests(userId: string): Promise<void> {
  await ensureLocationRequestsTable()
  await sql`
    UPDATE location_requests
    SET status = 'FULFILLED', fulfilled_at = NOW()
    WHERE target_user_id = ${userId} AND status = 'PENDING'
  `
}
