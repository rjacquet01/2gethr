import { sql } from "./db"
import { alertPlaceLimit } from "./subscription-tiers"

// Arrival/departure alerts per plan: Free none, Plus up to 3 places,
// Premium every place (lib/subscription-tiers.ts, limits.maxAlertPlaces).
// Over the limit (e.g. after moving down from Premium), only the family's
// oldest alert places keep alerting until some are turned off.

export { alertPlaceLimit }

/** Places in this family with alerts on, not counting `exceptPlaceId`. */
export async function alertPlacesInUse(familyId: string, exceptPlaceId?: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM saved_places
    WHERE family_id = ${familyId} AND geofence_enabled = true
      AND id <> ${exceptPlaceId ?? ""}
  `
  return Number(rows[0]?.n ?? 0)
}

/** Why alerts can't be turned on for one more place, or null if they can. */
export function alertLimitError(limit: number | null, inUse: number): string | null {
  if (limit === null || inUse < limit) return null
  if (limit === 0) return "Arrival and departure alerts come with Plus (3 places) or Premium (every place)"
  return `Your plan includes alerts on ${limit} places. Turn alerts off on another place, or upgrade to Premium for every place.`
}
