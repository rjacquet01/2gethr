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
 *
 * Inside a place (gap <= 0) the only thing to catch is leaving, which needs
 * getting past the edge plus the hysteresis margin, so someone moving around
 * inside (a school, an office) reports every 30s near the edge and every 60s
 * further in, instead of keeping GPS on every 15s all day.
 */
export function suggestedPingIntervalSec(gapMeters: number | null, movedMeters: number | null = null): number | null {
  if (gapMeters === null) return null
  if (movedMeters !== null && movedMeters < STATIONARY_METERS) return null
  if (gapMeters <= 0) return -gapMeters <= 100 ? 30 : 60
  if (gapMeters <= 300) return 15
  if (gapMeters <= 1000) return 30
  if (gapMeters <= 3000) return 60
  return null
}

/** The fastest hint any one place asks for (each place judged on its own gap). */
export function suggestedIntervalForGaps(gaps: number[], movedMeters: number | null = null): number | null {
  let best: number | null = null
  for (const g of gaps) {
    const h = suggestedPingIntervalSec(g, movedMeters)
    if (h !== null && (best === null || h < best)) best = h
  }
  return best
}

/** A recorded arrival/departure takes the fix's own time when it is at most this old. */
export const GEOFENCE_FIX_MAX_AGE_MS = 6 * 3600_000

/** A departure needs the fix before it to agree when the two are this close in time. */
export const DEPARTURE_CONFIRM_WINDOW_SEC = 600

/**
 * When an arrival/departure happened: the device's fix time, unless it is in
 * the future or older than GEOFENCE_FIX_MAX_AGE_MS (wrong clock, very old
 * backlog), then the server's now.
 */
export function geofenceEventTimeMs(fixMs: number, nowMs: number): number {
  return Number.isFinite(fixMs) && fixMs <= nowMs && fixMs >= nowMs - GEOFENCE_FIX_MAX_AGE_MS ? fixMs : nowMs
}

export interface GeofenceFix {
  latitude: number
  longitude: number
  accuracy?: number | null
  /** Device time of the fix. */
  timeMs: number
  /** Sent late from the phone's offline queue (not the newest fix). */
  queued?: boolean
}

export interface GeofencePlace {
  id: string
  latitude: number
  longitude: number
  radius: number
  /** Last recorded event here was an arrival. */
  wasInside: boolean
  /** Time of that last recorded event, if any. */
  lastEventMs: number | null
}

export interface PlannedTransition {
  placeId: string
  transition: "ARRIVAL" | "DEPARTURE"
  fix: GeofenceFix
  /** geofence_events.timestamp to record (geofenceEventTimeMs). */
  atMs: number
}

/**
 * Run fixes (oldest first, the newest last) past each place, carrying the
 * inside/outside state from one fix to the next, so an arrival seen only in a
 * delayed backlog is still recorded, at the time it happened. Each fix goes
 * through evaluateGeofence (trusted fixes only), and a departure still needs
 * the fix before it to agree when the two are close in time. A queued fix no
 * newer than the place's last recorded event can't change it. `gaps` are the
 * newest fix's distances to each place's edge.
 */
export function planGeofenceTransitions(
  places: GeofencePlace[],
  fixes: GeofenceFix[],
  prev: GeofenceFix | null,
  nowMs: number
): { transitions: PlannedTransition[]; gaps: number[] } {
  const state = new Map(places.map((p) => [p.id, { inside: p.wasInside, lastMs: p.lastEventMs }]))
  const transitions: PlannedTransition[] = []
  let before = prev
  for (const fix of fixes) {
    for (const place of places) {
      const s = state.get(place.id)!
      if (fix.queued && s.lastMs != null && fix.timeMs <= s.lastMs) continue
      const distance = distanceMeters(fix.latitude, fix.longitude, place.latitude, place.longitude)
      const transition = evaluateGeofence({ distance, accuracy: fix.accuracy, radius: place.radius, wasInside: s.inside })
      if (!transition) continue
      if (transition === "DEPARTURE" && before && Math.abs(fix.timeMs - before.timeMs) / 1000 < DEPARTURE_CONFIRM_WINDOW_SEC) {
        const prevDistance = distanceMeters(before.latitude, before.longitude, place.latitude, place.longitude)
        if (!confirmsDeparture({ distance: prevDistance, accuracy: before.accuracy }, place.radius)) continue
      }
      const atMs = geofenceEventTimeMs(fix.timeMs, nowMs)
      s.inside = transition === "ARRIVAL"
      s.lastMs = atMs
      transitions.push({ placeId: place.id, transition, fix, atMs })
    }
    before = fix
  }
  const last = fixes[fixes.length - 1]
  const gaps = last
    ? places.map((p) => distanceMeters(last.latitude, last.longitude, p.latitude, p.longitude) - p.radius)
    : []
  return { transitions, gaps }
}

/** A saved place as the Android app sees it: position and radius only. */
export interface BoostPlace {
  id: string
  lat: number
  lng: number
  /** Radius in metres. */
  r: number
}

/** At most this many places go to the phone. */
export const MAX_BOOST_PLACES = 50

/**
 * Compact list of places for the phone's precise-location boost: no names or
 * other details, coordinates rounded to ~1 m, each place once, capped.
 */
export function toBoostPlaces(rows: Record<string, unknown>[]): BoostPlace[] {
  const out: BoostPlace[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = String(row.id ?? "")
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    const r = Number(row.radius)
    if (!id || seen.has(id) || !Number.isFinite(lat) || !Number.isFinite(lng) || !(r > 0)) continue
    seen.add(id)
    out.push({ id, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, r: Math.round(r) })
    if (out.length >= MAX_BOOST_PLACES) break
  }
  return out
}
