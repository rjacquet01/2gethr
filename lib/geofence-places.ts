import { sql } from "./db"
import { checkFamilySubscription } from "./auth"
import { ensurePlaceNotifyChannelsColumn, ensurePlaceMembersTable } from "./place-schema"
import { alertPlaceLimit } from "./place-alerts"
import { toBoostPlaces, type BoostPlace } from "./geofence"

/**
 * Geofence-enabled places in this family that apply to this person: ones
 * assigned to nobody (everyone) or assigned to their membership here, and
 * only the family's oldest `alertLimit` (the plan's; null = all).
 */
export async function geofencePlacesFor(userId: string, familyId: string, alertLimit: number | null) {
  await ensurePlaceNotifyChannelsColumn()
  await ensurePlaceMembersTable()
  // LIMIT NULL is no limit.
  return sql`
    SELECT sp.id, sp.name, sp.latitude, sp.longitude, sp.radius, sp.alert_on_arrival, sp.alert_on_departure, sp.notify_channels
    FROM saved_places sp
    WHERE sp.family_id = ${familyId} AND sp.geofence_enabled = true
      AND sp.id IN (
        SELECT id FROM saved_places
        WHERE family_id = ${familyId} AND geofence_enabled = true
        ORDER BY created_at ASC, id ASC
        LIMIT ${alertLimit}
      )
      AND (
        NOT EXISTS (SELECT 1 FROM saved_place_members spm WHERE spm.place_id = sp.id)
        OR EXISTS (
          SELECT 1 FROM saved_place_members spm
          JOIN family_members fm ON fm.id = spm.family_member_id
          WHERE spm.place_id = sp.id AND fm.user_id = ${userId}
            AND fm.family_id = ${familyId} AND fm.is_active = true
        )
      )
  `
}

/**
 * The places the Android app may watch to switch on precise location near
 * them (app 1.2.10+): the same ones arrivals and departures are judged on,
 * in every family where this person shares their location and the plan has
 * place alerts. Position and radius only.
 */
export async function boostPlacesForUser(userId: string): Promise<BoostPlace[]> {
  const families = await sql`
    SELECT fm.family_id FROM family_members fm
    JOIN location_settings ls ON ls.family_member_id = fm.id
    WHERE fm.user_id = ${userId} AND fm.is_active = true AND fm.role <> 'GUEST'
      AND ls.mode = 'ACTIVE' AND ls.share_with_family = true
  `
  const rows: Record<string, unknown>[] = []
  for (const f of families) {
    const sub = await checkFamilySubscription(f.family_id as string)
    if (!sub.features.geofencing) continue
    rows.push(...(await geofencePlacesFor(userId, f.family_id as string, alertPlaceLimit(sub.tier))))
  }
  return toBoostPlaces(rows)
}
