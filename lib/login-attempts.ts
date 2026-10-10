import { sql } from "@/lib/db"

// Records failed login attempts so the risk scanner (/api/cron/risk-scan)
// can raise SUSPICIOUS_LOGIN flags (brute force / credential stuffing).
// Best-effort only: a failure here must never affect the login response.

let tableReady = false

export async function ensureLoginAttemptsTable() {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      user_id TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at)`
  tableReady = true
}

export async function recordFailedLogin(email: string, userId: string | null, ip: string | null) {
  try {
    await ensureLoginAttemptsTable()
    await sql`
      INSERT INTO login_attempts (email, user_id, ip)
      VALUES (${email.toLowerCase()}, ${userId}, ${ip})
    `
  } catch (error) {
    console.error("[login-attempts] failed to record attempt:", error)
  }
}
