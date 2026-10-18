import { sql } from "./db"

// The saved_places.notify_channels column ("Notify me via" for geofence alerts)
// was added by scripts/add-notify-channels-to-places.sql, which was never run
// on production. Without it editing/creating a place and the geofence check
// all failed. Add it idempotently the first time any place code runs.
let ensured: Promise<void> | null = null

export function ensurePlaceNotifyChannelsColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS notify_channels TEXT[]`
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS photo_path TEXT`
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS photo_url TEXT`
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS created_by_id TEXT`
      // Arrival/departure events before this time don't count toward who is
      // "inside" (set when the place is turned on/off, moved or resized).
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS geofence_state_reset_at TIMESTAMPTZ`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

// Places assigned to specific kids (scripts/add-place-members.sql). A place
// with no rows applies to everyone; with rows, only the assigned members'
// pings are checked against it.
let membersEnsured: Promise<void> | null = null

export function ensurePlaceMembersTable(): Promise<void> {
  if (!membersEnsured) {
    membersEnsured = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS saved_place_members (
          place_id TEXT NOT NULL REFERENCES saved_places(id) ON DELETE CASCADE,
          family_member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (place_id, family_member_id)
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_saved_place_members_member ON saved_place_members(family_member_id)`
    })().catch((err) => {
      membersEnsured = null
      throw err
    })
  }
  return membersEnsured
}

/**
 * Only active kids (role CHILD) of the place's own family can be assigned.
 * Returns an error message, or null when every id is allowed.
 */
export async function validatePlaceAssignees(familyId: string, memberIds: string[]): Promise<string | null> {
  if (memberIds.length === 0) return null
  const rows = await sql`
    SELECT id FROM family_members
    WHERE id = ANY(${memberIds}::text[]) AND family_id = ${familyId}
      AND role = 'CHILD' AND is_active = true
  `
  return rows.length === memberIds.length ? null : "Places can only be assigned to kids in this family"
}

/** Replace a place's assignment. Kept rows keep their original created_at. */
export async function setPlaceAssignees(placeId: string, memberIds: string[]): Promise<void> {
  await ensurePlaceMembersTable()
  await sql`
    WITH removed AS (
      DELETE FROM saved_place_members
      WHERE place_id = ${placeId} AND NOT (family_member_id = ANY(${memberIds}::text[]))
    )
    INSERT INTO saved_place_members (place_id, family_member_id)
    SELECT ${placeId}, unnest(${memberIds}::text[])
    ON CONFLICT DO NOTHING
  `
}

/** placeId -> assigned family_member ids, for the given places. */
export async function getPlaceAssignees(placeIds: string[]): Promise<Map<string, string[]>> {
  await ensurePlaceMembersTable()
  const map = new Map<string, string[]>()
  if (placeIds.length === 0) return map
  const rows = await sql`
    SELECT place_id, family_member_id FROM saved_place_members
    WHERE place_id = ANY(${placeIds}::text[])
  `
  for (const r of rows) {
    const list = map.get(r.place_id as string) ?? []
    list.push(r.family_member_id as string)
    map.set(r.place_id as string, list)
  }
  return map
}
