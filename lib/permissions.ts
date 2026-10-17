import { NextResponse } from "next/server"
import { sql } from "./db"

// Member roles (the family_role enum). Ownership is families.owner_id, not a role.
//  - PARENT:   runs the family (members, invites, conflicts).
//  - GUARDIAN: supervises children alongside parents.
//  - ADULT:    a peer member. Same calendar/task/places/location-sharing access
//              as a guardian, but does not supervise or approve for children.
//  - CHILD:    supervised member.
//  - GUEST:    calendar events and tasks only. No location, places or SOS.
export type FamilyRole = "PARENT" | "GUARDIAN" | "ADULT" | "CHILD" | "GUEST"

/** Roles that may view/manage children's data and approve things for them. */
export const SUPERVISOR_ROLES: readonly string[] = ["PARENT", "GUARDIAN"]
/** Grown-up members (not a child, not a guest). */
export const ADULT_MEMBER_ROLES: readonly string[] = ["PARENT", "GUARDIAN", "ADULT"]

export const isSupervisorRole = (role?: string | null) => !!role && SUPERVISOR_ROLES.includes(role)
export const isAdultMemberRole = (role?: string | null) => !!role && ADULT_MEMBER_ROLES.includes(role)

export const GUEST_FORBIDDEN_MESSAGE = "Not available for guest members"
export function guestForbidden() {
  return NextResponse.json({ success: false, error: GUEST_FORBIDDEN_MESSAGE }, { status: 403 })
}

export interface MemberAccess {
  role: FamilyRole
  isParent: boolean
  isGuardian: boolean
  isAdult: boolean
  isChild: boolean
  isGuest: boolean
  isOwner: boolean
}

/** The user's active role in a family, or null if they are not an active member. */
export async function getMemberAccess(familyId: string, userId: string): Promise<MemberAccess | null> {
  const rows = await sql`
    SELECT fm.role, (f.owner_id = ${userId}) AS is_owner
    FROM family_members fm JOIN families f ON f.id = fm.family_id
    WHERE fm.family_id = ${familyId} AND fm.user_id = ${userId} AND fm.is_active = true
    LIMIT 1
  `
  if (rows.length === 0) return null
  const role = rows[0].role as FamilyRole
  return {
    role,
    isParent: role === "PARENT",
    isGuardian: role === "GUARDIAN",
    isAdult: role === "ADULT",
    isChild: role === "CHILD",
    isGuest: role === "GUEST",
    isOwner: rows[0].is_owner === true,
  }
}

/** True for PARENT / GUARDIAN / ADULT / CHILD, false for GUEST or non-members. */
export async function requireFullMember(familyId: string, userId: string): Promise<boolean> {
  const access = await getMemberAccess(familyId, userId)
  return !!access && !access.isGuest
}

/** Owner of the family, or an active PARENT member (unchanged PARENT-only rule). */
export async function canManageFamily(familyId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM families f
    WHERE f.id = ${familyId}
      AND (
        f.owner_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM family_members fm
          WHERE fm.family_id = f.id AND fm.user_id = ${userId} AND fm.is_active = true AND fm.role = 'PARENT'
        )
      )
    LIMIT 1
  `
  return rows.length > 0
}

/** Is this user an active GUEST in this family? */
export async function isGuestInFamily(familyId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM family_members
    WHERE family_id = ${familyId} AND user_id = ${userId} AND is_active = true AND role = 'GUEST'
    LIMIT 1
  `
  return rows.length > 0
}

/**
 * The family a request means when it doesn't name one (calendar sync, the
 * iCal feed, older clients). A person can own one family and be a member,
 * often a guest, of others, so "first membership found" is not good enough:
 * prefer the family they own, then one where they are a full member (not a
 * guest), then the oldest membership. Returns the role in that family too,
 * so callers never mix a role from one family with another family's data.
 */
export async function defaultFamilyFor(userId: string): Promise<{ familyId: string; role: FamilyRole } | null> {
  const rows = await sql`
    SELECT fm.family_id, fm.role
    FROM family_members fm JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = ${userId} AND fm.is_active = true
    ORDER BY (f.owner_id = ${userId}) DESC, (fm.role = 'GUEST') ASC, fm.joined_at ASC
    LIMIT 1
  `
  return rows.length ? { familyId: rows[0].family_id as string, role: rows[0].role as FamilyRole } : null
}

/**
 * The caller's membership in one specific family (role included), or null
 * when they aren't an active member of it.
 */
export async function membershipIn(familyId: string, userId: string): Promise<{ familyId: string; role: FamilyRole } | null> {
  const rows = await sql`
    SELECT family_id, role FROM family_members
    WHERE family_id = ${familyId} AND user_id = ${userId} AND is_active = true
    LIMIT 1
  `
  return rows.length ? { familyId: rows[0].family_id as string, role: rows[0].role as FamilyRole } : null
}

/**
 * For routes that aren't tied to one family: true when the user has active
 * memberships and every one of them is GUEST (so they have no family where
 * location features apply).
 */
export async function isGuestOnly(userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE role = 'GUEST')::int AS guest,
      COUNT(*)::int AS total
    FROM family_members
    WHERE user_id = ${userId} AND is_active = true
  `
  return rows[0].total > 0 && rows[0].guest === rows[0].total
}
