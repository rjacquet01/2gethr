import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { ensureLoginAttemptsTable } from "@/lib/login-attempts"

// Populates the admin Risk Flags queue. Before this existed nothing ever
// inserted into risk_flags (only the admin UI read/updated it), so the page
// was permanently empty. Runs daily; each detector is idempotent - it skips a
// target that already has an active flag of the same type, or one closed in
// the last 30 days.

type Flag = {
  familyId?: string | null
  userId?: string | null
  ticketId?: string | null
  type: string
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  description: string
  evidence: Record<string, unknown>
}

async function raise(f: Flag): Promise<boolean> {
  // Ticket-based flags dedupe on the ticket itself, not on type + target.
  const existing = f.ticketId ? [] : await sql`
    SELECT 1 FROM risk_flags
    WHERE flag_type = ${f.type}
      AND family_id IS NOT DISTINCT FROM ${f.familyId ?? null}
      AND user_id IS NOT DISTINCT FROM ${f.userId ?? null}
      AND (status IN ('OPEN','INVESTIGATING','ESCALATED')
           OR updated_at > NOW() - INTERVAL '30 days')
    LIMIT 1
  `
  if (existing.length > 0) return false
  if (f.ticketId) {
    const byTicket = await sql`SELECT 1 FROM risk_flags WHERE ticket_id = ${f.ticketId}::uuid LIMIT 1`
    if (byTicket.length > 0) return false
  }
  await sql`
    INSERT INTO risk_flags (family_id, user_id, flag_type, severity, status, description, evidence, ticket_id)
    VALUES (${f.familyId ?? null}, ${f.userId ?? null}, ${f.type}, ${f.severity}, 'OPEN',
            ${f.description}, ${JSON.stringify(f.evidence)}::jsonb, ${f.ticketId ?? null}::uuid)
  `
  return true
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const created: Record<string, number> = {}
  const bump = (k: string, ok: boolean) => { if (ok) created[k] = (created[k] || 0) + 1 }
  const errors: string[] = []

  // 1. Past-due subscriptions -> chargeback / non-payment risk
  try {
    const rows = await sql`
      SELECT family_id, tier, current_period_end,
             GREATEST(0, EXTRACT(DAY FROM NOW() - current_period_end))::int AS days_overdue
      FROM subscriptions
      WHERE status = 'PAST_DUE'
        AND (current_period_end IS NULL OR current_period_end < NOW() - INTERVAL '3 days')
    `
    for (const r of rows) {
      const d = Number(r.days_overdue) || 0
      bump("CHARGEBACK_RISK", await raise({
        familyId: r.family_id, type: "CHARGEBACK_RISK",
        severity: d > 14 ? "HIGH" : "MEDIUM",
        description: `Subscription (${r.tier}) has been past due for ${d} days`,
        evidence: { tier: r.tier, daysOverdue: d },
      }))
    }
  } catch (e) { errors.push("past_due: " + (e as Error).message) }

  // 2. Several active accounts sharing one phone number
  try {
    const rows = await sql`
      SELECT phone, COUNT(*)::int AS n, array_agg(id) AS ids
      FROM users
      WHERE is_active = true AND phone IS NOT NULL AND phone <> ''
      GROUP BY phone HAVING COUNT(*) >= 3
    `
    for (const r of rows) {
      const ids: string[] = r.ids
      bump("MULTIPLE_ACCOUNTS", await raise({
        userId: ids[0], type: "MULTIPLE_ACCOUNTS", severity: "MEDIUM",
        description: `${r.n} active accounts share the same phone number`,
        evidence: { accountCount: r.n, userIds: ids },
      }))
    }
  } catch (e) { errors.push("multi_accounts: " + (e as Error).message) }

  // 3. One user owning many families (free-trial farming)
  try {
    const rows = await sql`
      SELECT owner_id, COUNT(*)::int AS n
      FROM families
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY owner_id HAVING COUNT(*) >= 3
    `
    for (const r of rows) {
      bump("ABUSIVE_SIGNUP_PATTERN", await raise({
        userId: r.owner_id, type: "ABUSIVE_SIGNUP_PATTERN", severity: "MEDIUM",
        description: `User created ${r.n} families in the last 30 days`,
        evidence: { familiesCreated: r.n },
      }))
    }
  } catch (e) { errors.push("signup_pattern: " + (e as Error).message) }

  // 4. Burst of signups from accounts created in the last hour sharing a family-name-less pattern is
  //    too noisy; instead flag unusually many registrations in 1 hour.
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS n FROM users
      WHERE created_at > NOW() - INTERVAL '1 hour'
        AND email NOT LIKE 'deleted-%@deleted.togethrapp.com'
    `
    const n = Number(rows[0]?.n) || 0
    if (n >= 15) {
      const first = await sql`SELECT id FROM users ORDER BY created_at DESC LIMIT 1`
      bump("ABUSIVE_SIGNUP_PATTERN", await raise({
        userId: first[0]?.id, type: "ABUSIVE_SIGNUP_PATTERN", severity: "HIGH",
        description: `${n} accounts registered within the last hour`,
        evidence: { registrationsLastHour: n },
      }))
    }
  } catch (e) { errors.push("signup_burst: " + (e as Error).message) }

  // 5. Failed-login bursts against one account (brute force)
  try {
    await ensureLoginAttemptsTable()
    await sql`DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '30 days'`
    const rows = await sql`
      SELECT email, MAX(user_id) AS user_id, COUNT(*)::int AS n, COUNT(DISTINCT ip)::int AS ips
      FROM login_attempts
      WHERE created_at > NOW() - INTERVAL '1 hour' AND user_id IS NOT NULL
      GROUP BY email HAVING COUNT(*) >= 10
    `
    for (const r of rows) {
      bump("SUSPICIOUS_LOGIN", await raise({
        userId: r.user_id, type: "SUSPICIOUS_LOGIN",
        severity: r.n >= 25 ? "HIGH" : "MEDIUM",
        description: `${r.n} failed logins in the last hour from ${r.ips} IP address(es)`,
        evidence: { failedAttempts: r.n, distinctIps: r.ips },
      }))
    }

    // 6. One IP failing against many different accounts (credential stuffing)
    const stuffing = await sql`
      SELECT ip, COUNT(DISTINCT email)::int AS emails, MAX(user_id) AS user_id
      FROM login_attempts
      WHERE created_at > NOW() - INTERVAL '1 hour' AND ip IS NOT NULL
      GROUP BY ip HAVING COUNT(DISTINCT email) >= 5
    `
    for (const r of stuffing) {
      if (!r.user_id) continue // flags need a user or family to attach to
      bump("SUSPICIOUS_LOGIN", await raise({
        userId: r.user_id, type: "SUSPICIOUS_LOGIN", severity: "HIGH",
        description: `One IP address tried ${r.emails} different accounts in the last hour (possible credential stuffing)`,
        evidence: { ip: r.ip, accountsTried: r.emails },
      }))
    }
  } catch (e) { errors.push("failed_logins: " + (e as Error).message) }

  // 7. Abuse reports filed through support
  try {
    const rows = await sql`
      SELECT id, ticket_number, subject, user_id, family_id
      FROM support_tickets
      WHERE category = 'ABUSE_REPORT' AND status NOT IN ('RESOLVED', 'CLOSED')
        AND (user_id IS NOT NULL OR family_id IS NOT NULL)
    `
    for (const r of rows) {
      bump("ABUSE_REPORT", await raise({
        userId: r.user_id, familyId: r.family_id, ticketId: r.id, type: "ABUSE_REPORT", severity: "HIGH",
        description: `Abuse report ticket ${r.ticket_number}: ${r.subject}`,
        evidence: { ticketNumber: r.ticket_number },
      }))
    }
  } catch (e) { errors.push("abuse_reports: " + (e as Error).message) }

  // 8. Support-ticket spam
  try {
    const rows = await sql`
      SELECT user_id, COUNT(*)::int AS n
      FROM support_tickets
      WHERE created_at > NOW() - INTERVAL '24 hours' AND user_id IS NOT NULL
      GROUP BY user_id HAVING COUNT(*) >= 5
    `
    for (const r of rows) {
      bump("SPAM_ACTIVITY", await raise({
        userId: r.user_id, type: "SPAM_ACTIVITY", severity: "LOW",
        description: `${r.n} support tickets submitted in the last 24 hours`,
        evidence: { ticketsLast24h: r.n },
      }))
    }
  } catch (e) { errors.push("ticket_spam: " + (e as Error).message) }

  return NextResponse.json({ success: true, created, errors })
}
