import { sql } from "./db"
import { logAuditEvent } from "./auth"
import { ensureConsentSchema } from "./consent-schema"
import { requestMeta } from "./parental-consent"
import { TERMS_VERSION } from "./consent-text"
import { memberName } from "./member-names"

// One-time confirmations for people who signed up before the age rule and
// parental consent existed (see docs/CHILDREN_DATA_POLICY.md):
// - an adult without age_confirmed_at / terms_accepted_at confirms once;
// - a child profile without any parental_consents row is shown to the
//   family's parents to confirm or withdraw.
// Nothing here locks anyone out of the API; the app shows the dialogs.

/** Is this user a child account (a login linked to a CHILD membership)? */
async function isChildAccount(userId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM family_members WHERE user_id = ${userId} AND role = 'CHILD' LIMIT 1`
  return rows.length > 0
}

/** True when an adult still has to confirm they are 18+ and accept the Terms. Child accounts never do. */
export async function needsAgeTermsConfirmation(userId: string): Promise<boolean> {
  await ensureConsentSchema()
  const rows = await sql`SELECT age_confirmed_at, terms_accepted_at FROM users WHERE id = ${userId} LIMIT 1`
  const u = rows[0]
  if (!u || (u.age_confirmed_at && u.terms_accepted_at)) return false
  return !(await isChildAccount(userId))
}

/**
 * An existing adult confirms their age and accepts the Terms and Privacy
 * Policy: stored on users, with the IP in consents (as at sign-up).
 */
export async function confirmAgeTerms(userId: string, request: Request): Promise<"confirmed" | "child"> {
  await ensureConsentSchema()
  if (await isChildAccount(userId)) return "child"
  const { ip, userAgent } = requestMeta(request)
  await sql`
    UPDATE users SET
      age_confirmed_at = COALESCE(age_confirmed_at, NOW()),
      terms_accepted_at = NOW(),
      terms_version = ${TERMS_VERSION},
      updated_at = NOW()
    WHERE id = ${userId}
  `
  for (const type of ["TERMS_OF_SERVICE", "PRIVACY_POLICY"]) {
    await sql`
      INSERT INTO consents (id, user_id, type, granted, ip_address, user_agent, granted_at, version)
      VALUES (${crypto.randomUUID()}, ${userId}, ${type}, true, ${ip}, ${userAgent}, NOW(), ${TERMS_VERSION})
    `
  }
  await logAuditEvent(userId, "UPDATE", "age_and_terms", userId, {
    newValue: { ageConfirmed: true, termsAccepted: true, termsVersion: TERMS_VERSION, existingUser: true },
    ipAddress: ip ?? undefined,
    userAgent: userAgent ?? undefined,
  })
  return "confirmed"
}

export interface ChildWithoutConsent {
  familyId: string
  familyName: string
  memberId: string
  name: string
  hasLogin: boolean
}

/** Children in families this user manages (parent or owner) with no parental consent record at all. */
export async function listChildrenWithoutConsent(userId: string): Promise<ChildWithoutConsent[]> {
  await ensureConsentSchema()
  const rows = await sql`
    SELECT fm.id, fm.family_id, fm.user_id, fm.nickname, f.name AS family_name, cp.display_name, u.first_name
    FROM family_members fm
    JOIN families f ON f.id = fm.family_id
    LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
    LEFT JOIN users u ON u.id = fm.user_id
    WHERE fm.role = 'CHILD'
      AND (
        f.owner_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM family_members p
          WHERE p.family_id = fm.family_id AND p.user_id = ${userId} AND p.is_active = true AND p.role = 'PARENT'
        )
      )
      AND NOT EXISTS (SELECT 1 FROM parental_consents pc WHERE pc.child_member_id = fm.id AND pc.family_id = fm.family_id)
    ORDER BY f.name, cp.display_name
  `
  return rows.map((r) => ({
    familyId: r.family_id as string,
    familyName: (r.family_name as string) || "Your family",
    memberId: r.id as string,
    name: memberName({ role: "CHILD", childDisplayName: r.display_name as string, nickname: r.nickname as string, firstName: r.first_name as string }, { fallback: "Your child" }),
    hasLogin: Boolean(r.user_id),
  }))
}
