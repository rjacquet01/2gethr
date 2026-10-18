import { sql } from "./db"

// Invite codes are single-use and bound to a role (PARENT, CHILD or GUEST) on
// the server. The role is never taken from the person joining. Parent joins
// wait for approval from an existing parent (family_join_requests).

export const INVITE_ROLES = ["PARENT", "CHILD", "GUEST"] as const
export type InviteRole = (typeof INVITE_ROLES)[number]
export type MemberRole = "PARENT" | "GUARDIAN" | "ADULT" | "CHILD" | "GUEST"

let ensured = false
export async function ensureInviteTables() {
  if (ensured) return
  await sql`
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
  await sql`CREATE INDEX IF NOT EXISTS idx_family_invites_family ON family_invites(family_id)`
  // An account invite for an existing accountless child profile carries the
  // child's member id and the parent's recorded consent.
  await sql`ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS child_member_id TEXT`
  await sql`ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS consent_by TEXT`
  await sql`ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ`
  await sql`
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
  await sql`CREATE INDEX IF NOT EXISTS idx_family_join_requests_family ON family_join_requests(family_id, status)`
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
