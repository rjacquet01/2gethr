import assert from "node:assert"
import { distanceMeters, evaluateGeofence, suggestedPingIntervalSec, suggestedIntervalForGaps, isTrustedFix, confirmsDeparture } from "../lib/geofence"

const HOME = { lat: 37.7749, lng: -122.4194 }
const R = 100
// metres north of home -> lat
const at = (northM: number) => ({ lat: HOME.lat + northM / 111320, lng: HOME.lng })

function run(path: { north: number; acc: number }[], radius = R) {
  let inside = false
  const events: string[] = []
  for (const p of path) {
    const pos = at(p.north)
    const d = distanceMeters(pos.lat, pos.lng, HOME.lat, HOME.lng)
    const t = evaluateGeofence({ distance: d, accuracy: p.acc, radius, wasInside: inside })
    if (t === "ARRIVAL") inside = true
    if (t === "DEPARTURE") inside = false
    if (t) events.push(t)
  }
  return events
}

// 1. Clean drive in then out.
assert.deepStrictEqual(
  run([2000, 800, 300, 90, 20, 0, 20, 150, 400, 2000].map((n) => ({ north: n, acc: 15 }))),
  ["ARRIVAL", "DEPARTURE"], "clean in/out")

// 2. Sitting at the edge with GPS jitter (+-25m around radius) -> at most 1 arrival, no flapping.
const jitter = Array.from({ length: 200 }, (_, i) => ({ north: R + Math.sin(i) * 25, acc: 20 }))
const jr = run([{ north: 500, acc: 10 }, ...jitter])
assert.ok(jr.length <= 1, "edge jitter flapped: " + jr.join(","))

// 3. Sitting inside, one wild fix far outside with poor accuracy must not depart.
assert.deepStrictEqual(
  run([{ north: 10, acc: 10 }, { north: 400, acc: 90 }, { north: 10, acc: 10 }]), ["ARRIVAL"], "bad fix ignored")

// 4. Poor accuracy never arrives.
assert.deepStrictEqual(run([{ north: 5, acc: 300 }]), [], "imprecise ignored")

// 5. Departure needs real distance (radius+buffer): 110m out is not left, 130m is.
assert.deepStrictEqual(run([{ north: 0, acc: 5 }, { north: 110, acc: 5 }]), ["ARRIVAL"])
assert.deepStrictEqual(run([{ north: 0, acc: 5 }, { north: 130, acc: 5 }]), ["ARRIVAL", "DEPARTURE"])

// 6. Small 50m geofence still works with typical 15m accuracy.
assert.deepStrictEqual(run([{ north: 300, acc: 15 }, { north: 30, acc: 15 }, { north: 90, acc: 15 }], 50), ["ARRIVAL", "DEPARTURE"])

// 6b. Accuracy must be within half the radius. 50m place: 25m ok, 30m ignored
// (the old 50m floor used to trust it). 100m place: 50m ok, 51m ignored.
assert.deepStrictEqual(run([{ north: 0, acc: 25 }], 50), ["ARRIVAL"], "50m place, 25m fix trusted")
assert.deepStrictEqual(run([{ north: 0, acc: 30 }], 50), [], "50m place, 30m fix ignored")
assert.deepStrictEqual(run([{ north: 0, acc: 50 }], 100), ["ARRIVAL"], "100m place, 50m fix trusted")
assert.deepStrictEqual(run([{ north: 0, acc: 51 }], 100), [], "100m place, 51m fix ignored")
// A coarse Wi-Fi/cell fix (~100m) never moves state for a 100m place, either way.
assert.deepStrictEqual(run([{ north: 0, acc: 10 }, { north: 600, acc: 100 }, { north: 0, acc: 10 }]), ["ARRIVAL"], "coarse fix can't depart")
// Unknown accuracy is never trusted.
assert.strictEqual(evaluateGeofence({ distance: 0, accuracy: null, radius: R, wasInside: false }), null)
assert.strictEqual(evaluateGeofence({ distance: 0, radius: R, wasInside: false }), null)
assert.strictEqual(evaluateGeofence({ distance: 500, accuracy: undefined, radius: R, wasInside: true }), null)
assert.strictEqual(isTrustedFix(NaN, R), false)
assert.strictEqual(isTrustedFix(-1, R), false)
assert.strictEqual(isTrustedFix(0, R), true)

// 6c. Departure confirmation: the previous fix must be trusted AND outside.
assert.strictEqual(confirmsDeparture({ distance: 150, accuracy: 10 }, R), true, "prev outside + precise confirms")
assert.strictEqual(confirmsDeparture({ distance: 80, accuracy: 10 }, R), false, "prev inside doesn't confirm")
assert.strictEqual(confirmsDeparture({ distance: 150, accuracy: 80 }, R), false, "prev too coarse doesn't confirm")
assert.strictEqual(confirmsDeparture({ distance: 150, accuracy: null }, R), false, "prev unknown accuracy doesn't confirm")

// 7. Adaptive interval hints.
assert.strictEqual(suggestedPingIntervalSec(null), null)
// Inside a place: only leaving matters, so no 15s GPS while moving around inside.
assert.strictEqual(suggestedPingIntervalSec(-50), 30, "inside, near the edge")
assert.strictEqual(suggestedPingIntervalSec(0), 30, "on the edge counts as inside")
assert.strictEqual(suggestedPingIntervalSec(-250), 60, "deep inside a large place")
assert.strictEqual(suggestedPingIntervalSec(1), 15, "just outside: arrivals stay fast")
// Each place judged on its own gap: inside Home but approaching School stays fast.
assert.strictEqual(suggestedIntervalForGaps([-80, 120], 50), 15)
assert.strictEqual(suggestedIntervalForGaps([-250, 5000], 50), 60)
assert.strictEqual(suggestedIntervalForGaps([-250, 5000], 5), null, "still: user's interval")
assert.strictEqual(suggestedIntervalForGaps([]), null)
assert.strictEqual(suggestedPingIntervalSec(500), 30)
assert.strictEqual(suggestedPingIntervalSec(2000), 60)
assert.strictEqual(suggestedPingIntervalSec(10000), null)
// Standing still near/inside a geofence: no speed-up (the user's interval applies).
assert.strictEqual(suggestedPingIntervalSec(-50, 5), null)
assert.strictEqual(suggestedPingIntervalSec(100, 24), null)
// Moving near a boundary: report fast again.
assert.strictEqual(suggestedPingIntervalSec(100, 80), 15)
assert.strictEqual(suggestedPingIntervalSec(500, 300), 30)

// 8. Detection latency: walking 1.4 m/s toward a 100m fence, pings every 15s vs 300s.
function latency(intervalSec: number) {
  const inside = false
  for (let t = 0; t < 3600; t += 1) {
    if (t % intervalSec) continue
    const north = 1000 - 1.4 * t
    const d = Math.abs(north)
    if (evaluateGeofence({ distance: d, accuracy: 10, radius: R, wasInside: inside }) === "ARRIVAL") {
      const trueArrival = (1000 - R) / 1.4
      return Math.round(t - trueArrival)
    }
  }
  return -1
}
console.log("walking past a fence: arrival delay @15s =", latency(15), "s; @300s =", latency(300) === -1 ? "MISSED entirely" : latency(300) + "s")
console.log("geofence tests passed")
