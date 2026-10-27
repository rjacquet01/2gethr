import { sql } from "./db"
import { assertAccountCanBeClosed, closeUserAccount } from "./account-closure"
import { isUnderLegalHold } from "./legal"
import { ensureConsentSchema } from "./consent-schema"
import { CHILD_CONSENT_VERSION, CHILD_CONSENT_TEXT } from "./consent-text"

export { ensureConsentSchema }

// Age rule and consent records (see docs/CHILDREN_DATA_POLICY.md):
// - Only adults (18+) create their own account; they confirm their age and
//   accept the Terms and Privacy Policy at sign-up (stored on users).
// - Children exist only because a parent added them. Every child profile or
//   child account is created with a parent's explicit consent, stored in
//   parental_consents with the exact text the parent saw.
// - A parent can withdraw consent; that deletes the child's data.

export type ConsentScope = "CHILD_PROFILE" | "CHILD_ACCOUNT"

/** The caller's IP (first x-forwarded-for hop) and user agent, for consent records. */
export function requestMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const fwd = request.headers.get("x-forwarded-for")
  const ip = (fwd ? fwd.split(",")[0].trim() : request.headers.get("x-real-ip")) || null
  return { ip, userAgent: request.headers.get("user-agent") || null }
}

/** Does this child have any consent record (current or withdrawn)? */
export async function hasParentalConsentRecord(familyId: string, childMemberId: string): Promise<boolean> {
  await ensureConsentSchema()
  const rows = await sql`SELECT 1 FROM parental_consents WHERE child_member_id = ${childMemberId} AND family_id = ${familyId} LIMIT 1`
  return rows.length > 0
}

export async function recordParentalConsent(opts: {
  familyId: string
  parentUserId: string
  childMemberId: string
  childUserId?: string | null
  scope: ConsentScope
  request: Request
}): Promise<string> {
  await ensureConsentSchema()
  const { ip, userAgent } = requestMeta(opts.request)
  const id = crypto.randomUUID()
  await sql`
    INSERT INTO parental_consents (
      id, family_id, parent_user_id, child_member_id, child_user_id, scope,
      consent_text_version, consent_text, ip_address, user_agent, granted_at
    ) VALUES (
      ${id}, ${opts.familyId}, ${opts.parentUserId}, ${opts.childMemberId}, ${opts.childUserId ?? null}, ${opts.scope},
      ${CHILD_CONSENT_VERSION}, ${CHILD_CONSENT_TEXT}, ${ip}, ${userAgent}, NOW()
    )
  `
  return id
}

/**
 * Delete what we hold about a child in one family: the child profile (name,
 * birthdate, school, notes), location settings and place assignments go with
 * the membership row. A child with their own login keeps that login only when
 * `closeAccount` is false; consent withdrawal closes it too.
 */
export async function deleteChildData(opts: {
  familyId: string
  childMemberId: string
  /** always: consent withdrawn. if-no-other-family: removed from this family only. */
  closeAccount: "always" | "if-no-other-family"
}): Promise<{ deleted: boolean; closedUserId: string | null }> {
  const rows = await sql`
    SELECT fm.id, fm.user_id, fm.role, u.email
    FROM family_members fm LEFT JOIN users u ON u.id = fm.user_id
    WHERE fm.id = ${opts.childMemberId} AND fm.family_id = ${opts.familyId} AND fm.role = 'CHILD'
    LIMIT 1
  `
  const child = rows[0]
  if (!child) return { deleted: false, closedUserId: null }

  let closedUserId: string | null = null
  let close = opts.closeAccount === "always"
  if (child.user_id && !close) {
    const other = await sql`
      SELECT 1 FROM family_members
      WHERE user_id = ${child.user_id} AND family_id <> ${opts.familyId} AND is_active = true
      LIMIT 1
    `
    close = other.length === 0
  }
  // A legal hold on the child stops this before anything changes (LegalHoldError).
  if (child.user_id && close) await assertAccountCanBeClosed(child.user_id as string)

  // Unused account codes for this child can no longer be used.
  await sql`UPDATE family_invites SET revoked_at = NOW() WHERE child_member_id = ${opts.childMemberId} AND used_at IS NULL AND revoked_at IS NULL`

  if (child.user_id && close) {
    // Removes their memberships (and so this child profile), sessions,
    // location history and personal fields, and blocks the login.
    await closeUserAccount({ id: child.user_id as string, email: (child.email as string) || "" })
    closedUserId = child.user_id as string
  }
  // Cascades to child_profiles, location_settings and saved_place_members;
  // tasks keep existing with their child link cleared.
  await sql`DELETE FROM family_members WHERE id = ${opts.childMemberId} AND family_id = ${opts.familyId} AND role = 'CHILD'`
  return { deleted: true, closedUserId }
}

/**
 * Consent is withdrawn (by a parent in the app, or by a Togethr admin acting
 * on a request): the records are marked withdrawn and kept, then the child's
 * data is deleted. withdrawnBy is the parent's user id or the admin's id.
 */
export async function withdrawChildConsent(opts: {
  familyId: string
  childMemberId: string
  withdrawnBy: string
  /**
   * A parent withdrawing for a child added before consent was recorded: with
   * no record to mark, one is written (granted and withdrawn at once) so the
   * decision is kept.
   */
  recordIfNone?: { parentUserId: string; request: Request }
}) {
  await ensureConsentSchema()
  // The child's login is closed below; under a legal hold nothing changes (LegalHoldError).
  const login = await sql`SELECT user_id FROM family_members WHERE id = ${opts.childMemberId} AND family_id = ${opts.familyId} AND role = 'CHILD' LIMIT 1`
  if (login[0]?.user_id) await assertAccountCanBeClosed(login[0].user_id as string)
  if (opts.recordIfNone) {
    if (!(await hasParentalConsentRecord(opts.familyId, opts.childMemberId))) {
      const child = await sql`SELECT user_id FROM family_members WHERE id = ${opts.childMemberId} AND family_id = ${opts.familyId} AND role = 'CHILD' LIMIT 1`
      if (child[0]) {
        const { ip, userAgent } = requestMeta(opts.recordIfNone.request)
        await sql`
          INSERT INTO parental_consents (
            id, family_id, parent_user_id, child_member_id, child_user_id, scope,
            consent_text_version, consent_text, ip_address, user_agent, granted_at, withdrawn_at, withdrawn_by
          ) VALUES (
            ${crypto.randomUUID()}, ${opts.familyId}, ${opts.recordIfNone.parentUserId}, ${opts.childMemberId}, ${(child[0].user_id as string) ?? null},
            ${child[0].user_id ? "CHILD_ACCOUNT" : "CHILD_PROFILE"}, ${CHILD_CONSENT_VERSION}, ${NO_PRIOR_CONSENT_NOTE + "\n" + CHILD_CONSENT_TEXT},
            ${ip}, ${userAgent}, NOW(), NOW(), ${opts.withdrawnBy}
          )
        `
      }
    }
  }
  await sql`
    UPDATE parental_consents SET withdrawn_at = NOW(), withdrawn_by = ${opts.withdrawnBy}
    WHERE child_member_id = ${opts.childMemberId} AND family_id = ${opts.familyId} AND withdrawn_at IS NULL
  `
  return deleteChildData({ familyId: opts.familyId, childMemberId: opts.childMemberId, closeAccount: "always" })
}

/** Stored ahead of the consent text when a parent withdraws for a child with no earlier record. */
export const NO_PRIOR_CONSENT_NOTE =
  "No consent was on record: this profile was created before consent was recorded. The parent withdrew instead of confirming."

/**
 * Before a family is deleted: whether a legal hold covers a child login that
 * the deletion would close (one with no other family). Checked first, so the
 * family is refused whole instead of being half deleted.
 */
export async function familyChildAccountUnderHold(familyId: string): Promise<boolean> {
  const kids = await sql`
    SELECT fm.user_id FROM family_members fm
    WHERE fm.family_id = ${familyId} AND fm.role = 'CHILD' AND fm.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM family_members o
        WHERE o.user_id = fm.user_id AND o.family_id <> ${familyId} AND o.is_active = true
      )
  `
  for (const k of kids) if (await isUnderLegalHold(k.user_id as string)) return true
  return false
}

/** A family is deleted: delete every child's data in it (logins only if they have no other family). */
export async function deleteFamilyChildren(familyId: string): Promise<number> {
  const kids = await sql`SELECT id FROM family_members WHERE family_id = ${familyId} AND role = 'CHILD'`
  let n = 0
  for (const k of kids) {
    const r = await deleteChildData({ familyId, childMemberId: k.id as string, closeAccount: "if-no-other-family" })
    if (r.deleted) n++
  }
  return n
}

export async function listParentalConsents(familyId: string, childMemberId: string) {
  await ensureConsentSchema()
  const rows = await sql`
    SELECT pc.id, pc.scope, pc.consent_text_version, pc.consent_text, pc.granted_at, pc.withdrawn_at,
           u.first_name, u.last_name
    FROM parental_consents pc LEFT JOIN users u ON u.id = pc.parent_user_id
    WHERE pc.family_id = ${familyId} AND pc.child_member_id = ${childMemberId}
    ORDER BY pc.granted_at DESC
  `
  return rows.map((r) => ({
    id: r.id as string,
    scope: r.scope as ConsentScope,
    version: r.consent_text_version as string,
    text: r.consent_text as string,
    grantedAt: r.granted_at,
    withdrawnAt: r.withdrawn_at ?? null,
    grantedBy: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "A parent",
  }))
}
