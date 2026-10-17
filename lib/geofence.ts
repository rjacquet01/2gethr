// Pure geofence decision logic, kept free of db/Next imports so it can be
// unit-tested (see scripts/test-geofence.ts) and reused by the ping route.

export type GeofenceTransition = "ARRIVAL" | "DEPARTURE" | null

const EARTH_RADIUS_M = 6371e3

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Extra distance beyond the radius a person must travel to count as "left". */
export function hysteresisBuffer(radius: number): number {
  return Math.max(20, radius * 0.15)
}

/** Largest reported GPS error we will trust for a place of this radius: half the radius. */
export function maxTrustedAccuracy(radius: number): number {
  return radius / 2
}

/**
 * Only fixes that report their accuracy, and are at least as precise as half
 * the place's radius, may cause an arrival or departure. A fix with unknown
 * accuracy can't be checked, so it is never trusted.
 */
export function isTrustedFix(accuracy: number | null | undefined, radius: number): boolean {
  return typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= maxTrustedAccuracy(radius)
}

/**
 * A departure needs a second, earlier fix that agrees: the previous fix must
 * itself be trusted and outside the radius. One stray fix can't fire a "left".
 */
export function confirmsDeparture(prev: { distance: number; accuracy: number | null | undefined }, radius: number): boolean {
  return isTrustedFix(prev.accuracy, radius) && prev.distance > radius
}

/**
 * Decide whether a ping causes an arrival/departure.
 * - ARRIVAL: previously outside and the fix is inside the radius.
 * - DEPARTURE: previously inside and the fix is confidently outside, i.e.
 *   even after giving the fix the benefit of its own error margin the person
 *   is beyond radius + hysteresis. This stops a single noisy fix near the
 *   edge from producing a false "left".
 * - Fixes less precise than half the radius, or with unknown accuracy, are
 *   ignored either way.
 */
export function evaluateGeofence(opts: {
  distance: number
  accuracy?: number | null
  radius: number
  wasInside: boolean
}): GeofenceTransition {
  const { distance, radius, wasInside } = opts
  if (!isTrustedFix(opts.accuracy, radius)) return null
  const accuracy = opts.accuracy as number

  if (!wasInside) {
    return distance <= radius ? "ARRIVAL" : null
  }
  const confidentDistance = distance - Math.min(accuracy, radius)
  return confidentDistance > radius + hysteresisBuffer(radius) ? "DEPARTURE" : null
}

/** Movement below this between two pings counts as standing still (GPS noise). */
export const STATIONARY_METERS = 25

/**
 * How often the device should report while near a geofence. Returns seconds,
 * or null when the user's own setting is fine. `gapMeters` is the distance
 * from the person to the nearest geofence edge (negative/zero = inside).
 * `movedMeters` is how far they moved since the previous ping (null = unknown).
 *
 * Fast reporting only helps catch a crossing while someone is moving. A phone
 * sitting at home is always "near" the Home boundary, and used to be told to
 * report every 15s around the clock; when it hasn't moved, the user's own
 * interval is used instead, and fast reporting resumes as soon as it moves.
 */
export function suggestedPingIntervalSec(gapMeters: number | null, movedMeters: number | null = null): number | null {
  if (gapMeters === null) return null
  if (movedMeters !== null && movedMeters < STATIONARY_METERS) return null
  const gap = Math.max(0, gapMeters)
  if (gap <= 300) return 15
  if (gap <= 1000) return 30
  if (gap <= 3000) return 60
  return null
}
