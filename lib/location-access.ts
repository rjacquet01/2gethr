import { sql } from "./db"
import { ddl } from "./schema-snapshot"
import { isAdultMemberRole } from "./permissions"

// Grown-ups (PARENT / GUARDIAN / ADULT) don't see each other's location by
// default: one must ask and the other approve. A grant is one-way: owner ->
// viewer means the viewer sees the owner (whenever the owner is sharing).
// Children are unaffected: supervisors see sharing kids, kids see sharing
// grown-ups. Denying, cancelling or removing access deletes the row.
let ensured: Promise<void> | null = null

export function ensureLocationAccessTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`
        CREATE TABLE IF NOT EXISTS location_access_grants (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
          owner_member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          viewer_member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          decided_at TIMESTAMPTZ,
          UNIQUE (owner_member_id, viewer_member_id)
        )
      `
      await ddl`CREATE INDEX IF NOT EXISTS idx_location_access_viewer ON location_access_grants(viewer_member_id, status)`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

/** Seeing this member needs an approved grant: both are grown-ups and not the same membership. */
export function needsAccessGrant(viewerRole: string, viewerMemberId: string, targetRole: string, targetMemberId: string) {
  return viewerMemberId !== targetMemberId && isAdultMemberRole(viewerRole) && isAdultMemberRole(targetRole)
}

/** Memberships whose location this member has been approved to see. */
export async function approvedOwnerMemberIds(viewerMemberId: string): Promise<Set<string>> {
  await ensureLocationAccessTable()
  const rows = await sql`
    SELECT owner_member_id FROM location_access_grants
    WHERE viewer_member_id = ${viewerMemberId} AND status = 'APPROVED'
  `
  return new Set(rows.map((r) => r.owner_member_id as string))
}

export async function hasApprovedAccess(viewerMemberId: string, ownerMemberId: string): Promise<boolean> {
  await ensureLocationAccessTable()
  const rows = await sql`
    SELECT 1 FROM location_access_grants
    WHERE owner_member_id = ${ownerMemberId} AND viewer_member_id = ${viewerMemberId} AND status = 'APPROVED'
    LIMIT 1
  `
  return rows.length > 0
}

/**
 * Who in this family may hear about this person's whereabouts (arrivals,
 * low battery): null when the person is a child (everyone who supervises
 * may), otherwise the user ids of grown-ups they approved.
 */
export async function locationAudienceUserIds(familyId: string, userId: string): Promise<string[] | null> {
  const me = await sql`
    SELECT id, role FROM family_members
    WHERE family_id = ${familyId} AND user_id = ${userId} AND is_active = true
    LIMIT 1
  `
  if (me.length === 0 || !isAdultMemberRole(me[0].role as string)) return null
  await ensureLocationAccessTable()
  const rows = await sql`
    SELECT fm.user_id FROM location_access_grants g
    JOIN family_members fm ON fm.id = g.viewer_member_id AND fm.is_active = true
    WHERE g.owner_member_id = ${me[0].id} AND g.status = 'APPROVED'
  `
  return rows.map((r) => r.user_id as string)
}
