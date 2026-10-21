import { sql } from "@/lib/db"
import { ddl } from "./schema-snapshot"

// Small database-backed rate limiter (serverless instances share nothing in
// memory). Each call records one hit for `key` and says whether the caller is
// still within `limit` hits per `windowSec`. Used to slow down password and
// 2FA-code guessing and reset-email floods.

let tableReady = false

async function ensureTable() {
  if (tableReady) return
  await ddl`
    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await ddl`CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_key ON rate_limit_hits(key, created_at)`
  tableReady = true
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSec: number
}

/** Records a hit and checks it against the limit. Fails open on DB errors. */
export async function hitRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  try {
    await ensureTable()
    const rows = await sql`
      WITH ins AS (INSERT INTO rate_limit_hits (key) VALUES (${key}) RETURNING created_at)
      SELECT count(*)::int AS n, min(created_at) AS oldest
      FROM rate_limit_hits
      WHERE key = ${key} AND created_at > NOW() - make_interval(secs => ${windowSec}::int)
    `
    // The CTE's own row isn't visible to the SELECT, so add it.
    const n = Number(rows[0]?.n || 0) + 1
    // Occasionally drop old rows so the table stays small.
    if (Math.random() < 0.02) {
      await sql`DELETE FROM rate_limit_hits WHERE created_at < NOW() - INTERVAL '1 day'`
    }
    if (n <= limit) return { allowed: true, retryAfterSec: 0 }
    const oldest = rows[0]?.oldest ? new Date(rows[0].oldest).getTime() : Date.now()
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowSec * 1000 - Date.now()) / 1000))
    return { allowed: false, retryAfterSec }
  } catch (error) {
    console.error("[rate-limit] check failed:", error)
    return { allowed: true, retryAfterSec: 0 }
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"
}

export function tooManyRequests(retryAfterSec: number, what = "attempts") {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60))
  return Response.json(
    { success: false, error: `Too many ${what}. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  )
}
