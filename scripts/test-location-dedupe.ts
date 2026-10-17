import assert from "node:assert"
import { DEDUPE_RADIUS_M, DEDUPE_WINDOW_MS, pingInsertedAt, shouldMergeWithPrevious } from "../lib/location-dedupe"
import { distanceMeters, evaluateGeofence, confirmsDeparture } from "../lib/geofence"

// --- pure decision -----------------------------------------------------------
const id = (ms: number) => `ping_${ms}_abc1234`
assert.strictEqual(pingInsertedAt(id(1760700000000)), 1760700000000)
assert.strictEqual(pingInsertedAt("loc_123"), null)
assert.strictEqual(pingInsertedAt(null), null)

const S = 1760700000000 // a real ms timestamp, as row ids carry
const base = { next: { latitude: 0, longitude: 0 }, geofenceChanged: false, hasQueued: false }
const prev = (ms: number) => ({ id: id(ms), latitude: 0, longitude: 0 })
assert.strictEqual(shouldMergeWithPrevious({ ...base, prev: prev(S), distanceM: 5, nowMs: S + 60_000 }), true, "near + recent -> merge")
assert.strictEqual(shouldMergeWithPrevious({ ...base, prev: prev(S), distanceM: DEDUPE_RADIUS_M, nowMs: S + 60_000 }), false, "15 m away -> new row")
assert.strictEqual(shouldMergeWithPrevious({ ...base, prev: prev(S), distanceM: 5, nowMs: S + DEDUPE_WINDOW_MS }), false, "5 min since the row began -> new row")
assert.strictEqual(shouldMergeWithPrevious({ ...base, prev: prev(S), distanceM: 5, nowMs: S + 60_000, geofenceChanged: true }), false, "geofence change -> new row")
assert.strictEqual(shouldMergeWithPrevious({ ...base, prev: prev(S), distanceM: 5, nowMs: S + 60_000, hasQueued: true }), false, "offline queue -> new rows")
assert.strictEqual(shouldMergeWithPrevious({ ...base, prev: null, distanceM: null, nowMs: S }), false, "first ping -> new row")
assert.strictEqual(shouldMergeWithPrevious({ ...base, prev: { id: "legacy", latitude: 0, longitude: 0 }, distanceM: 1, nowMs: S }), false, "unknown id format -> new row")

// --- route flow ----------------------------------------------------------------
// Replays POST /api/location's write sequence with an in-memory table:
// previous ping -> geofence evaluation (lib/geofence, incl. the two-fix
// departure confirmation) -> merge-or-insert (lib/location-dedupe).
const HOME = { lat: 42.64288, lng: -71.11603, radius: 100 }
const at = (northM: number) => ({ lat: HOME.lat + northM / 111320, lng: HOME.lng })

type Row = { id: string; lat: number; lng: number; acc: number; ts: number }
const rows: Row[] = []
const events: { type: string; at: number }[] = [{ type: "ARRIVAL", at: -1 }] // already home
let seq = 0

function post(northM: number, acc: number, nowMs: number) {
  const here = at(northM)
  const last = rows[rows.length - 1]
  const prevPing = last ? { latitude: last.lat, longitude: last.lng, accuracy: last.acc, ageSec: (nowMs - last.ts) / 1000 } : null
  // geofence first, like the route
  const distance = distanceMeters(here.lat, here.lng, HOME.lat, HOME.lng)
  const wasInside = events[events.length - 1].type === "ARRIVAL"
  let transition = evaluateGeofence({ distance, accuracy: acc, radius: HOME.radius, wasInside })
  if (transition === "DEPARTURE" && prevPing && prevPing.ageSec < 600) {
    const prevDistance = distanceMeters(prevPing.latitude, prevPing.longitude, HOME.lat, HOME.lng)
    if (!confirmsDeparture({ distance: prevDistance, accuracy: prevPing.accuracy }, HOME.radius)) transition = null
  }
  if (transition) events.push({ type: transition, at: nowMs })
  const moved = prevPing ? distanceMeters(prevPing.latitude, prevPing.longitude, here.lat, here.lng) : null
  const merge = shouldMergeWithPrevious({
    prev: last ? { id: last.id, latitude: last.lat, longitude: last.lng } : null,
    next: { latitude: here.lat, longitude: here.lng },
    distanceM: moved,
    nowMs,
    geofenceChanged: !!transition,
    hasQueued: false,
  })
  // Like the route: a merge moves the row's time; a new row's id carries its insert time.
  if (merge) last.ts = nowMs
  else rows.push({ id: `ping_${nowMs}_${String(seq++).padStart(7, "0")}`, lat: here.lat, lng: here.lng, acc, ts: nowMs })
  return { merged: merge, transition }
}
const T0 = 1760700000000
const realPost = (northM: number, acc: number, min: number) => post(northM, acc, t(min))
const t = (min: number) => T0 + min * 60_000

// 1. Sitting at home, a report every minute: one row per 5-minute window.
for (let m = 0; m < 10; m++) realPost(Math.sin(m) * 5, 15, m)
assert.strictEqual(rows.length, 2, `10 still reports over 10 min -> 2 rows, got ${rows.length}`)
assert.strictEqual(rows[rows.length - 1].ts, t(9), "the latest row carries the latest time (last seen stays fresh)")
assert.strictEqual(events.length, 1, "no geofence events while home")

// 2. Leaving home. First fix outside (130 m) can't confirm a departure on its own.
let r = realPost(130, 10, 10.5)
assert.strictEqual(r.transition, null, "one outside fix is not a departure")
assert.strictEqual(r.merged, false, "moved >15 m -> new row")
const before = rows.length
// Next fix only 8 m further (within the 15 m dedupe radius, under 5 min) DOES
// confirm the departure: it must still be stored as its own row, and fire once.
r = realPost(138, 10, 11)
assert.strictEqual(r.transition, "DEPARTURE")
assert.strictEqual(r.merged, false, "a report that changed geofence state is never merged")
assert.strictEqual(rows.length, before + 1)
assert.strictEqual(events.filter((e) => e.type === "DEPARTURE").length, 1, "exactly one departure")
// Standing just outside now: merged again, and no second departure.
r = realPost(141, 10, 11.5)
assert.strictEqual(r.transition, null)
assert.strictEqual(r.merged, true)
assert.strictEqual(events.filter((e) => e.type === "DEPARTURE").length, 1, "still exactly one departure")

// 3. Coming back home: exactly one arrival, own row.
r = realPost(20, 10, 20)
assert.strictEqual(r.transition, "ARRIVAL")
assert.strictEqual(r.merged, false)
assert.strictEqual(events.filter((e) => e.type === "ARRIVAL").length, 2)

console.log(`rows written: ${rows.length}, geofence events: ${events.length - 1}`)
console.log("location dedupe tests passed")
