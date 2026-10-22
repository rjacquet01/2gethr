import { sql } from "./db"
import { ddl } from "./schema-snapshot"
import { ensureAgeColumns } from "./age-schema"
import { ensureConsentSchema } from "./consent-schema"
import { syncChildNameFromProfile } from "./member-names"

// Invite codes are single-use and bound to a role (PARENT, CHILD or GUEST) on
// the server. The role is never taken from the person joining. Parent joins
// wait for approval from an existing parent (family_join_requests).

export const INVITE_ROLES = ["PARENT", "CHILD", "GUEST"] as const
export type InviteRole = (typeof INVITE_ROLES)[number]
export type MemberRole = "PARENT" | "GUARDIAN" | "ADULT" | "CHILD" | "GUEST"

let ensured = false
export async function ensureInviteTables() {
  if (ensured) return
  await ddl`
    CREATE TABLE IF NOT EXISTS family_invites (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      used_by TEXT,
      revoked_at TIMESTAMPTZ
    )
  `
  await ddl`CREATE INDEX IF NOT EXISTS idx_family_invites_family ON family_invites(family_id)`
  // An account invite for an existing accountless child profile carries the
  // child's member id and the parent's recorded consent.
  await ddl`ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS child_member_id TEXT`
  await ddl`ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS consent_by TEXT`
  await ddl`ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ`
  await ddl`
    CREATE TABLE IF NOT EXISTS family_join_requests (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      invite_id TEXT,
      role TEXT NOT NULL,
      nickname TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      decided_by TEXT
    )
  `
  await ddl`CREATE INDEX IF NOT EXISTS idx_family_join_requests_family ON family_join_requests(family_id, status)`
  ensured = true
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ""
  for (let i = 0; i < 8; i++) code += chars.charAt(bytes[i] % chars.length)
  return code
}

/** Owner of the family, or an active PARENT member, may manage invites. */
export async function canManageInvites(familyId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM families f
    WHERE f.id = ${familyId}
      AND (
        -- The owner must still be an active member: a deleted family keeps
        -- owner_id but has no active members, and must not mint invites.
        (f.owner_id = ${userId} AND EXISTS (
          SELECT 1 FROM family_members om
          WHERE om.family_id = f.id AND om.user_id = ${userId} AND om.is_active = true
        ))
        OR EXISTS (
          SELECT 1 FROM family_members fm
          WHERE fm.family_id = f.id AND fm.user_id = ${userId} AND fm.is_active = true AND fm.role = 'PARENT'
        )
      )
    LIMIT 1
  `
  return rows.length > 0
}

export function getRolePermissions(role: string) {
  switch (role) {
    case "PARENT":
      return { canCreateEvents: true, requiresEventApproval: false, canOverrideConflicts: true, canViewFamilyCalendar: true, canInviteMembers: true }
    case "GUARDIAN":
    case "ADULT":
      return { canCreateEvents: true, requiresEventApproval: false, canOverrideConflicts: false, canViewFamilyCalendar: true, canInviteMembers: false }
    case "GUEST":
      return { canCreateEvents: true, requiresEventApproval: true, canOverrideConflicts: false, canViewFamilyCalendar: true, canInviteMembers: false }
    default:
      return { canCreateEvents: false, requiresEventApproval: true, canOverrideConflicts: false, canViewFamilyCalendar: true, canInviteMembers: false }
  }
}

/**
 * A parent (or owner) of one family must not become a PARENT of a different
 * family just because they were invited. Still used by the member-role editor.
 */
export async function isParentInOtherFamily(familyId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    -- Only an ACTIVE parent membership counts. (Owners always have one; a deleted
    -- family has all members deactivated, so its old owner is not capped.)
    SELECT 1 FROM family_members fm
    WHERE fm.family_id <> ${familyId} AND fm.user_id = ${userId} AND fm.is_active = true AND fm.role = 'PARENT'
    LIMIT 1
  `
  return rows.length > 0
}

/**
 * Already an active member (any role) of a different family. Someone who
 * uses a parent code while belonging to another family is not made a PARENT:
 * the approving parent picks Guardian or Guest for them instead.
 */
export async function belongsToOtherFamily(familyId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM family_members fm
    WHERE fm.family_id <> ${familyId} AND fm.user_id = ${userId} AND fm.is_active = true
    LIMIT 1
  `
  return rows.length > 0
}

/** Roles the approving parent may choose for a cross-family parent-code join. */
export const CROSS_FAMILY_ROLES = ["GUARDIAN", "GUEST"] as const
export type CrossFamilyRole = (typeof CROSS_FAMILY_ROLES)[number]

/**
 * Last line of defense: a PARENT grant for someone who belongs to another
 * family becomes GUEST (the default the approver is shown). Callers that let
 * the approver choose pass GUARDIAN or GUEST explicitly, so this only fires
 * if something asks for PARENT anyway.
 */
export async function effectiveRole(familyId: string, userId: string, requested: MemberRole): Promise<MemberRole> {
  if (requested === "PARENT" && (await belongsToOtherFamily(familyId, userId))) return "GUEST"
  return requested
}

/**
 * Create (or reactivate) the family membership for a user with a fixed role.
 * CHILD memberships also get a child profile and default location settings.
 * GUEST memberships get neither (guests have no location features).
 */
export async function activateMember(opts: { familyId: string; userId: string; role: MemberRole; nickname: string }) {
  const { familyId, userId, nickname } = opts
  const role = await effectiveRole(familyId, userId, opts.role)
  const p = getRolePermissions(role)
  const existing = await sql`SELECT id FROM family_members WHERE family_id = ${familyId} AND user_id = ${userId} LIMIT 1`
  let memberId: string
  if (existing.length > 0) {
    memberId = existing[0].id
    await sql`
      UPDATE family_members
      SET is_active = true, role = ${role}, nickname = ${nickname}, joined_at = NOW(),
          can_create_events = ${p.canCreateEvents}, requires_event_approval = ${p.requiresEventApproval},
          can_override_conflicts = ${p.canOverrideConflicts}, can_view_family_calendar = ${p.canViewFamilyCalendar},
          can_invite_members = ${p.canInviteMembers}, updated_at = NOW()
      WHERE id = ${memberId}
    `
  } else {
    memberId = crypto.randomUUID()
    await sql`
      INSERT INTO family_members (
        id, family_id, user_id, role, nickname, is_active, joined_at,
        can_create_events, requires_event_approval, can_override_conflicts,
        can_view_family_calendar, can_invite_members, created_at, updated_at
      )
      VALUES (
        ${memberId}, ${familyId}, ${userId}, ${role}, ${nickname}, true, NOW(),
        ${p.canCreateEvents}, ${p.requiresEventApproval}, ${p.canOverrideConflicts},
        ${p.canViewFamilyCalendar}, ${p.canInviteMembers}, NOW(), NOW()
      )
    `
  }
  if (role === "CHILD") {
    const cp = await sql`SELECT id FROM child_profiles WHERE family_member_id = ${memberId} LIMIT 1`
    if (cp.length === 0) {
      await sql`
        INSERT INTO child_profiles (id, family_member_id, display_name, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${memberId}, ${nickname}, NOW(), NOW())
      `
    }
    const ls = await sql`SELECT id FROM location_settings WHERE family_member_id = ${memberId} LIMIT 1`
    if (ls.length === 0) {
      await sql`
        INSERT INTO location_settings (id, family_member_id, mode, share_with_family, update_interval_sec, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${memberId}, 'OFF', false, 300, NOW(), NOW())
      `
    }
  }
  return memberId
}

export interface ChildAccountInvite {
  id: string
  familyId: string
  familyName: string
  childMemberId: string
  childName: string
  consentBy: string
}

/**
 * A parent-made account code for an existing child profile (the parent ticked
 * the consent box when making it). This is the only way a child gets a login:
 * it is used while creating the account (/register), never by an existing one.
 */
export async function findChildAccountInvite(code: string): Promise<{ ok: true; invite: ChildAccountInvite } | { ok: false; error: string; childCode: boolean }> {
  await ensureInviteTables()
  await ensureAgeColumns()
  const rows = await sql`
    SELECT i.id, i.family_id, i.role, i.expires_at, i.used_at, i.revoked_at, i.child_member_id, i.consent_by,
           f.name AS family_name, fm.user_id AS child_user_id, fm.role AS child_role, fm.is_active AS child_active,
           cp.display_name, cp.age, to_char(cp.date_of_birth, 'YYYY-MM-DD') AS dob
    FROM family_invites i
    JOIN families f ON f.id = i.family_id
    LEFT JOIN family_members fm ON fm.id = i.child_member_id AND fm.family_id = i.family_id
    LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
    WHERE i.code = ${code.trim().toUpperCase()}
    LIMIT 1
  `
  const r = rows[0]
  // childCode: the code is a child account code, just not usable now.
  const bad = (error: string, childCode = true) => ({ ok: false as const, error, childCode })
  if (!r) return bad("Invalid invite code. Ask a parent for a new one.", false)
  if (r.role !== "CHILD" || !r.child_member_id || !r.consent_by) return bad("This code can't create a child's account. A parent adds children in Family > Add child.", false)
  if (r.revoked_at) return bad("This code was cancelled. Ask a parent for a new one.")
  if (r.used_at) return bad("This code was already used. Ask a parent for a new one.")
  if (new Date(r.expires_at) < new Date()) return bad("This code has expired. Ask a parent for a new one.")
  if (r.child_role !== "CHILD" || !r.child_active || r.child_user_id) return bad("This account code is no longer valid. Ask a parent for a new one.")
  // No minimum age: the parent's code, made with their consent, is what
  // allows the child's account.
  return {
    ok: true,
    invite: {
      id: r.id,
      familyId: r.family_id,
      familyName: r.family_name,
      childMemberId: r.child_member_id,
      childName: (r.display_name as string) || "Your child",
      consentBy: r.consent_by,
    },
  }
}

/** Use up a child account code for a just-created user. Returns false if someone else used it first. */
export async function consumeChildAccountInvite(invite: ChildAccountInvite, userId: string): Promise<boolean> {
  const consumed = await sql`
    UPDATE family_invites SET used_at = NOW(), used_by = ${userId}
    WHERE id = ${invite.id} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    RETURNING id
  `
  return consumed.length > 0
}

/** Give a consumed code back (the account could not be finished). */
export async function releaseChildAccountInvite(invite: ChildAccountInvite, userId: string): Promise<void> {
  await sql`UPDATE family_invites SET used_at = NULL, used_by = NULL WHERE id = ${invite.id} AND used_by = ${userId}`
}

/**
 * Attach a new login to the child's existing membership. Location sharing
 * stays off. The parent's consent record is tied to the new login.
 */
export async function linkChildLogin(invite: ChildAccountInvite, userId: string): Promise<boolean> {
  const linked = await sql`
    UPDATE family_members SET user_id = ${userId}, is_active = true, updated_at = NOW()
    WHERE id = ${invite.childMemberId} AND family_id = ${invite.familyId} AND user_id IS NULL AND role = 'CHILD'
    RETURNING id
  `
  if (linked.length === 0) return false
  // The child's name is the one the parent gave, on their login too.
  await syncChildNameFromProfile(invite.childMemberId)
  const ls = await sql`
    UPDATE location_settings SET mode = 'OFF', share_with_family = false, updated_at = NOW()
    WHERE family_member_id = ${invite.childMemberId} RETURNING id
  `
  if (ls.length === 0) {
    await sql`
      INSERT INTO location_settings (id, family_member_id, mode, share_with_family, update_interval_sec, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${invite.childMemberId}, 'OFF', false, 300, NOW(), NOW())
    `
  }
  await ensureConsentSchema()
  await sql`
    UPDATE parental_consents SET child_user_id = ${userId}
    WHERE child_member_id = ${invite.childMemberId} AND family_id = ${invite.familyId} AND scope = 'CHILD_ACCOUNT'
      AND child_user_id IS NULL AND withdrawn_at IS NULL
  `
  return true
}
