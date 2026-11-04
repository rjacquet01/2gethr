import { sql } from "@/lib/db"
import { escapeHtml, notifyAdmin } from "@/lib/services/email"

/**
 * One email to admin@mytogethr.com for each change to an account, made by
 * the user (front end) or by an admin (admin portal). Account-level changes
 * only: profile, sign-in, family membership, plan. Routine activity (tasks,
 * events, chat) and Stripe webhook changes (they have their own notices) don't
 * come here. Never throws; notifyAdmin swallows send errors.
 */

export type AccountChangeValue = string | number | boolean | null | undefined
/** A before/after pair; rendered "old -> new". */
export interface FieldChange {
  from: AccountChangeValue
  to: AccountChangeValue
}

export interface AccountChange {
  /** Who made the change: their email, or a label such as "system". */
  actor: string
  actorType: "user" | "admin"
  /** The account that changed. */
  accountEmail: string
  familyName?: string | null
  /** Short label, e.g. "Profile updated". Goes in the subject. */
  change: string
  /** Non-sensitive detail. An empty object means nothing changed: no email. */
  details?: Record<string, AccountChangeValue | FieldChange>
  ipAddress?: string | null
}

// Tests swap notifyAdmin to see what would be sent.
export const accountAlertDeps = { notifyAdmin }

// Never shown, only "changed".
const SECRET_KEY = /pass(word|wd)?|token|secret|hash|totp|otp|mfa|2fa|recovery|backup|card|cvc|cvv|birth/i
// Shown masked: j***@example.com, ***1234.
const MASKED_KEY = /email|phone/i

export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@")
  if (at < 1) return "***"
  return `${value[0]}***${value.slice(at)}`
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "")
  return digits.length > 4 ? `***${digits.slice(-4)}` : "***"
}

function shown(key: string, value: AccountChangeValue): string {
  if (value === null || value === undefined || value === "") return "none"
  const s = String(value)
  if (MASKED_KEY.test(key)) return s.includes("@") ? maskEmail(s) : maskPhone(s)
  return s
}

function isFieldChange(v: unknown): v is FieldChange {
  return typeof v === "object" && v !== null && "from" in v && "to" in v
}

function detailLine(key: string, value: AccountChangeValue | FieldChange): string {
  if (SECRET_KEY.test(key)) return `${key}: changed`
  if (isFieldChange(value)) return `${key}: ${shown(key, value.from)} -> ${shown(key, value.to)}`
  return `${key}: ${shown(key, value)}`
}

/**
 * The fields of `after` that differ from `before`, as before/after pairs.
 * Undefined in `after` means "not submitted". Empty when nothing changed.
 */
export function changedFields(
  before: Record<string, AccountChangeValue>,
  after: Record<string, AccountChangeValue>
): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {}
  const norm = (v: AccountChangeValue) => (v === undefined || v === "" ? null : v)
  for (const [key, to] of Object.entries(after)) {
    if (to === undefined) continue
    if (norm(before[key]) !== norm(to)) out[key] = { from: before[key] ?? null, to }
  }
  return out
}

/**
 * The account behind a family membership, for the email: its login email, or
 * for a child profile with no login, the child's name. Null when not found.
 */
export async function memberAccount(memberId: string): Promise<{ accountEmail: string; familyName: string; role: string } | null> {
  try {
    const rows = await sql`
      SELECT u.email, f.name AS family_name, fm.role,
        CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE COALESCE(NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) END AS member_name
      FROM family_members fm
      JOIN families f ON f.id = fm.family_id
      LEFT JOIN users u ON u.id = fm.user_id
      LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
      WHERE fm.id = ${memberId}
    `
    const r = rows[0]
    if (!r) return null
    const accountEmail = r.email || `${r.member_name || "Family member"} (child profile, no login)`
    return { accountEmail, familyName: r.family_name, role: r.role }
  } catch (error) {
    console.error("[account-alert] member lookup failed:", error)
    return null
  }
}

/** A family's owner email and name, for plan changes. Null when not found. */
export async function familyOwnerAccount(familyId: string): Promise<{ accountEmail: string; familyName: string } | null> {
  try {
    const rows = await sql`
      SELECT u.email, f.name FROM families f JOIN users u ON u.id = f.owner_id WHERE f.id = ${familyId}
    `
    return rows[0] ? { accountEmail: rows[0].email, familyName: rows[0].name } : null
  } catch (error) {
    console.error("[account-alert] family lookup failed:", error)
    return null
  }
}

/** First x-forwarded-for hop, or x-real-ip. */
export function requestIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null
}

export function accountChangeEmail(c: AccountChange) {
  const rows: [string, string][] = [
    ["Account", c.accountEmail],
    ["Change", c.change],
    ["Made by", `${c.actor} (${c.actorType === "admin" ? "admin portal" : "user"})`],
  ]
  if (c.familyName) rows.push(["Family", c.familyName])
  if (c.ipAddress) rows.push(["IP address", c.ipAddress])
  rows.push(["When", new Date().toISOString()])
  const lines = Object.entries(c.details ?? {}).map(([k, v]) => detailLine(k, v))

  return {
    subject: `[Togethr] Account change: ${c.change} - ${c.accountEmail}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <h2 style="color: #3b4563;">Account change</h2>
        ${rows.map(([k, v]) => `<p><strong>${k}:</strong> ${escapeHtml(v)}</p>`).join("\n        ")}
        ${lines.length ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` : ""}
      </div>
    `,
    text: [...rows.map(([k, v]) => `${k}: ${v}`), ...(lines.length ? ["", ...lines] : [])].join("\n"),
  }
}

export async function notifyAccountChange(c: AccountChange): Promise<void> {
  if (c.details && Object.keys(c.details).length === 0) return
  try {
    const email = accountChangeEmail(c)
    await accountAlertDeps.notifyAdmin(email.subject, email.html, email.text)
  } catch (error) {
    console.error("[account-alert] failed:", error)
  }
}
