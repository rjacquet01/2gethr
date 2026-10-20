import { NextRequest } from "next/server"
import { createHash } from "crypto"
import { sql, type Row } from "./db"
import { getAdminFromRequest, logAdminAction, type AdminUser } from "./admin-auth"

// Legal requests (subpoena / warrant / court order / emergency).
// There is no standing admin access to location or account data. Access exists
// only through an approved case, is limited to the case scope and time window,
// is read-only, and every step lands in an append-only log.

export const LEGAL_ROLE = "LEGAL_COMPLIANCE"
export const PERM_MANAGE = "legal.manage"
export const PERM_APPROVE = "legal.approve"
export const MAX_ACCESS_HOURS = 168
export const DEFAULT_ACCESS_HOURS = 72
export const EMERGENCY_ACCESS_HOURS = 12
export const EMERGENCY_REVIEW_HOURS = 72
export const CASE_TYPES = ["SUBPOENA", "WARRANT", "COURT_ORDER", "EMERGENCY"] as const
export type CaseType = (typeof CASE_TYPES)[number]

let ensured: Promise<void> | null = null
export function ensureLegalTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS legal_cases (
          id TEXT PRIMARY KEY,
          case_number TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN',
          agency TEXT NOT NULL,
          requester_name TEXT NOT NULL,
          requester_contact TEXT NOT NULL,
          reference_number TEXT,
          document_ref TEXT,
          summary TEXT,
          scope_family_id TEXT,
          scope_user_id TEXT,
          scope_from TIMESTAMPTZ NOT NULL,
          scope_to TIMESTAMPTZ NOT NULL,
          includes_live_ping BOOLEAN NOT NULL DEFAULT false,
          nondisclosure BOOLEAN NOT NULL DEFAULT false,
          counsel_reviewed BOOLEAN NOT NULL DEFAULT false,
          counsel_notes TEXT,
          emergency_reason TEXT,
          emergency_review_status TEXT,
          emergency_reviewed_by TEXT,
          emergency_reviewed_at TIMESTAMPTZ,
          emergency_review_notes TEXT,
          opened_by TEXT NOT NULL,
          opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          approved_by TEXT,
          approved_at TIMESTAMPTZ,
          access_expires_at TIMESTAMPTZ,
          preserve_until TIMESTAMPTZ,
          family_notified_at TIMESTAMPTZ,
          closed_by TEXT,
          closed_at TIMESTAMPTZ,
          denied_reason TEXT
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS legal_access_log (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          admin_id TEXT,
          action TEXT NOT NULL,
          detail JSONB,
          ip_address TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_legal_access_log_case ON legal_access_log(case_id, created_at)`
      await sql`
        CREATE TABLE IF NOT EXISTS legal_exports (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          admin_id TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          counts JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      // The log can be added to but never edited or deleted.
      try {
        await sql`
          CREATE OR REPLACE FUNCTION legal_log_immutable() RETURNS trigger AS $$
          BEGIN RAISE EXCEPTION 'legal_access_log is append-only'; END;
          $$ LANGUAGE plpgsql
        `
        await sql`DROP TRIGGER IF EXISTS legal_access_log_immutable ON legal_access_log`
        await sql`
          CREATE TRIGGER legal_access_log_immutable BEFORE UPDATE OR DELETE ON legal_access_log
          FOR EACH ROW EXECUTE FUNCTION legal_log_immutable()
        `
      } catch (e) {
        console.error("legal log trigger setup failed:", e)
      }
      // Role + permissions. SUPER_ADMIN does NOT get these implicitly (see legalPerm).
      await sql`
        INSERT INTO admin_roles (name, description, is_system_role)
        VALUES (${LEGAL_ROLE}, 'Handles law-enforcement and legal requests. Access to user data only through approved cases.', true)
        ON CONFLICT (name) DO NOTHING
      `
      await sql`
        INSERT INTO admin_permissions (key, name, description, category) VALUES
          (${PERM_MANAGE}, 'Manage legal requests', 'Open and work legal cases, view scoped data under an approved case', 'legal'),
          (${PERM_APPROVE}, 'Approve legal requests', 'Approve or deny legal cases and review emergency disclosures', 'legal')
        ON CONFLICT (key) DO NOTHING
      `
      await sql`
        INSERT INTO admin_role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM admin_roles r, admin_permissions p
        WHERE r.name = ${LEGAL_ROLE} AND p.key IN (${PERM_MANAGE}, ${PERM_APPROVE})
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `
    })().catch((e) => {
      ensured = null
      throw e
    })
  }
  return ensured
}

/** Explicit permission only: SUPER_ADMIN does not bypass legal controls. */
export function legalPerm(admin: AdminUser, key: string): boolean {
  return admin.permissions.includes(key)
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined
}

export async function legalLog(caseId: string, adminId: string | null, action: string, detail: Record<string, unknown>, request?: Request) {
  await sql`
    INSERT INTO legal_access_log (id, case_id, admin_id, action, detail, ip_address)
    VALUES (${crypto.randomUUID()}, ${caseId}, ${adminId}, ${action}, ${JSON.stringify(detail)}::jsonb, ${request ? clientIp(request) || null : null})
  `
  if (adminId) {
    // Also appears in the general admin audit trail (no target id: that column is a UUID).
    await logAdminAction(adminId, `LEGAL_${action}`, "legal_case", null, { caseId, ...detail }, request ? clientIp(request) : undefined)
  }
}

export async function requireLegalAdmin(request: NextRequest, perm: string) {
  const { admin, error } = await getAdminFromRequest(request)
  if (!admin) return { status: 401 as const, error: error || "Unauthorized" }
  if (!legalPerm(admin, perm)) return { status: 403 as const, error: "Legal access required. Ask a super admin to assign the Legal Compliance role." }
  await ensureLegalTables()
  return { admin }
}

export async function nextCaseNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const r = await sql`SELECT COUNT(*)::int AS n FROM legal_cases WHERE case_number LIKE ${`LR-${year}-%`}`
  return `LR-${year}-${String((r[0]?.n || 0) + 1).padStart(4, "0")}`
}

export function accessActive(c: { status: string; access_expires_at: string | null }): boolean {
  return c.status === "APPROVED" && !!c.access_expires_at && new Date(c.access_expires_at).getTime() > Date.now()
}

export function mapCase(c: any) {
  const emergencyOverdue =
    c.type === "EMERGENCY" && c.emergency_review_status === "PENDING" &&
    new Date(c.opened_at).getTime() + EMERGENCY_REVIEW_HOURS * 3600 * 1000 < Date.now()
  return {
    id: c.id,
    caseNumber: c.case_number,
    type: c.type,
    status: c.status,
    agency: c.agency,
    requesterName: c.requester_name,
    requesterContact: c.requester_contact,
    referenceNumber: c.reference_number,
    documentRef: c.document_ref,
    summary: c.summary,
    scopeFamilyId: c.scope_family_id,
    scopeUserId: c.scope_user_id,
    scopeFrom: c.scope_from,
    scopeTo: c.scope_to,
    includesLivePing: c.includes_live_ping,
    nondisclosure: c.nondisclosure,
    counselReviewed: c.counsel_reviewed,
    counselNotes: c.counsel_notes,
    emergencyReason: c.emergency_reason,
    emergencyReviewStatus: c.emergency_review_status,
    emergencyReviewNotes: c.emergency_review_notes,
    emergencyReviewOverdue: emergencyOverdue,
    openedBy: c.opened_by,
    openedAt: c.opened_at,
    approvedBy: c.approved_by,
    approvedAt: c.approved_at,
    accessExpiresAt: c.access_expires_at,
    accessActive: accessActive(c),
    preserveUntil: c.preserve_until,
    familyNotifiedAt: c.family_notified_at,
    closedAt: c.closed_at,
    deniedReason: c.denied_reason,
  }
}

export async function getCase(id: string) {
  const r = (await sql`SELECT * FROM legal_cases WHERE id = ${id} LIMIT 1`) as Row<{ status: string; access_expires_at: string | null }>[]
  return r[0] || null
}

/** Users the case covers: one person, or everyone who has been in the family. */
export async function scopeUserIds(c: any): Promise<string[]> {
  if (c.scope_user_id) {
    if (c.scope_family_id) {
      const r = await sql`SELECT user_id FROM family_members WHERE family_id = ${c.scope_family_id} AND user_id = ${c.scope_user_id} LIMIT 1`
      return r.map((x: any) => x.user_id)
    }
    return [c.scope_user_id]
  }
  if (c.scope_family_id) {
    const r = await sql`SELECT DISTINCT user_id FROM family_members WHERE family_id = ${c.scope_family_id} AND user_id IS NOT NULL`
    return r.map((x: any) => x.user_id)
  }
  return []
}

export function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

/** True while any open/approved case (or a preservation request) covers this user. */
export async function isUnderLegalHold(userId: string): Promise<boolean> {
  try {
    await ensureLegalTables()
    const r = await sql`
      SELECT 1 FROM legal_cases c
      WHERE (c.status IN ('OPEN','APPROVED') OR c.preserve_until > NOW())
        AND (
          c.scope_user_id = ${userId}
          OR (c.scope_family_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM family_members fm WHERE fm.family_id = c.scope_family_id AND fm.user_id = ${userId}))
        )
      LIMIT 1
    `
    return r.length > 0
  } catch (e) {
    console.error("legal hold check failed:", e)
    return true // when unsure, keep the data
  }
}
