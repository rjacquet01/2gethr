import { sql } from "./db"

// scripts/create-location-requests-table.sql was never run on production, so
// "Request location now" could not even store its request. Create it lazily.
let ensured: Promise<void> | null = null

export function ensureLocationRequestsTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`
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
      await sql`CREATE INDEX IF NOT EXISTS idx_location_requests_target_user ON location_requests(target_user_id, status)`
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
