// Server-side dedupe for location pings (used by POST /api/location).
// Pure so it can be unit tested (scripts/test-location-dedupe.ts).
//
// A phone sitting still keeps reporting the same spot. Instead of a new row
// for each report, the previous row is moved forward in time ("still here at
// <now>"), so last-seen stays fresh while the history keeps one row per stay
// segment. A new row is still written at least every DEDUPE_WINDOW_MS, when
// the phone has moved DEDUPE_RADIUS_M or more, or when the report changed a
// geofence state (arrival/departure). Geofences are evaluated on every
// report either way.

export const DEDUPE_RADIUS_M = 15
export const DEDUPE_WINDOW_MS = 5 * 60_000

/**
 * When a ping row was first inserted. Row ids are `ping_<ms>_<random>`
 * (see app/api/location/route.ts); the row's `timestamp` can't be used
 * because merging moves it forward. null when the id isn't in that form.
 */
export function pingInsertedAt(id: string | null | undefined): number | null {
  const m = /^ping_(\d{12,})_/.exec(id ?? '')
  if (!m) return null
  const ms = Number(m[1])
  return Number.isFinite(ms) ? ms : null
}

/**
 * A grown-up's "Share now" while their sharing is off stores one fix with a
 * marked id (`ping_<ms>_once_<memberId>_<random>`, still readable by
 * pingInsertedAt), so GET /api/location can show that single fix to the one
 * family it was shared with, for a while, without turning sharing on. Such a
 * row is never merged into, so later fixes can't extend it.
 */
export function oneTimePingId(nowMs: number, memberId: string): string {
  return `ping_${nowMs}_once_${memberId}_${Math.random().toString(36).substring(2, 9)}`
}

/** A one-time share row; with memberId, one shared by that membership. */
export function isOneTimePingId(id: string | null | undefined, memberId?: string): boolean {
  const s = id ?? ''
  if (!/^ping_\d{12,}_once_/.test(s)) return false
  return memberId == null || s.slice(s.indexOf('_once_') + 6).startsWith(`${memberId}_`)
}

export function shouldMergeWithPrevious(opts: {
  /** previous row: its id and position */
  prev: { id: string; latitude: number; longitude: number } | null
  next: { latitude: number; longitude: number }
  /** metres between prev and next */
  distanceM: number | null
  nowMs: number
  /** this report recorded an arrival or departure */
  geofenceChanged: boolean
  /** extra fixes queued offline came with this report */
  hasQueued: boolean
}): boolean {
  const { prev, distanceM, nowMs, geofenceChanged, hasQueued } = opts
  if (!prev || geofenceChanged || hasQueued || distanceM == null) return false
  if (isOneTimePingId(prev.id)) return false
  if (distanceM >= DEDUPE_RADIUS_M) return false
  const insertedAt = pingInsertedAt(prev.id)
  if (insertedAt == null) return false
  const age = nowMs - insertedAt
  return age >= 0 && age < DEDUPE_WINDOW_MS
}
