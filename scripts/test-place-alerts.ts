// Usage: npx tsx --tsconfig tsconfig.json scripts/test-place-alerts.ts
// Arrival/departure alerts per plan (lib/place-alerts.ts): Free none, Plus up
// to 3 places, Premium every place. Creating a place with alerts on, and
// turning alerts on for an existing one, are refused past the limit; a place
// that already has them can still be edited. In-memory saved_places /
// subscriptions (lib/db __setSqlForTests): no database, no network.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "place-alerts-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "place-alerts-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "place-alerts-test-admin-secret-not-real-0123456789"

let passed = 0
const ok = (name: string) => {
  passed++
  console.log(`  ok  ${name}`)
}

type Place = { id: string; family_id: string; name: string; geofence_enabled: boolean; created_at: string }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { alertPlaceLimit, alertLimitError } = await import("../lib/place-alerts")
  const { SUBSCRIPTION_TIERS } = await import("../lib/subscription-tiers")
  const placesRoute = await import("../app/api/places/route")
  const placeRoute = await import("../app/api/places/[placeId]/route")

  // --- the limits ---
  assert.equal(alertPlaceLimit("FREE"), 0)
  assert.equal(alertPlaceLimit("PREMIUM"), 3)
  assert.equal(alertPlaceLimit("PREMIUM_PLUS"), null)
  assert.equal(alertPlaceLimit(null), 0)
  assert.equal(alertPlaceLimit("nonsense"), 0)
  assert.equal(SUBSCRIPTION_TIERS.PREMIUM.features.geofencing, true)
  assert.ok(SUBSCRIPTION_TIERS.PREMIUM.featureList.includes("Arrival & departure alerts (3 places)"))
  // The landing page shows each plan's first five bullets.
  assert.ok(SUBSCRIPTION_TIERS.PREMIUM.featureList.slice(0, 5).some((f) => f.startsWith("Arrival & departure alerts")))
  ok("limits: Free 0, Plus 3, Premium every place; Plus lists it in its first five bullets")

  assert.equal(alertLimitError(3, 2), null)
  assert.match(alertLimitError(3, 3)!, /alerts on 3 places/)
  assert.match(alertLimitError(0, 0)!, /Plus \(3 places\) or Premium/)
  assert.equal(alertLimitError(null, 49), null)
  ok("limit messages: room left, full, none on this plan, unlimited")

  // --- routes ---
  let tier = "PREMIUM"
  const places: Place[] = []
  const fam = "6f0c2d3e-8a1b-4c5d-9e7f-0a1b2c3d4e5f"
  const add = (n: number, on: boolean) => {
    for (let i = 0; i < n; i++) {
      places.push({ id: `p${places.length + 1}`, family_id: fam, name: `Place ${places.length + 1}`, geofence_enabled: on, created_at: new Date(2026, 0, places.length + 1).toISOString() })
    }
  }
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.includes("FROM users") && q.includes("WHERE id =")) return [{ id: "u1", email: "p@example.invalid", first_name: "P", is_active: true, role: "USER" }]
    if (q.startsWith("SELECT role FROM family_members")) return [{ role: "PARENT" }]
    if (q.startsWith("SELECT tier, status, trial_ends_at FROM subscriptions")) return tier === "FREE" ? [] : [{ tier, status: "ACTIVE" }]
    if (q.startsWith("SELECT COUNT(*) as count FROM saved_places")) return [{ count: places.filter((p) => p.family_id === v[0]).length }]
    if (q.startsWith("SELECT COUNT(*)::int AS n FROM saved_places")) {
      return [{ n: places.filter((p) => p.family_id === v[0] && p.geofence_enabled && p.id !== v[1]).length }]
    }
    if (q.startsWith("INSERT INTO saved_places")) {
      places.push({ id: String(v[0]), family_id: String(v[1]), name: String(v[2]), geofence_enabled: v[7] === true, created_at: new Date().toISOString() })
      return []
    }
    if (q.startsWith("SELECT sp.*, fm.role FROM saved_places sp")) {
      const p = places.find((x) => x.id === v[0])
      return p ? [{ ...p, role: "PARENT", created_by_id: "u1" }] : []
    }
    if (q.startsWith("UPDATE saved_places SET")) {
      const p = places.find((x) => x.id === v[v.length - 1])
      if (p && q.includes("geofence_enabled")) p.geofence_enabled = true
      return []
    }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const token = await generateAccessToken("u1")
  const create = async (geofenceEnabled: boolean) => {
    const req = new Request("http://localhost/api/places", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ familyId: fam, name: "New place", latitude: 42.36, longitude: -71.06, radius: 150, geofenceEnabled }),
    })
    const res = await placesRoute.POST(req as never)
    return { status: res.status, json: await res.json() }
  }
  const turnOn = async (id: string, extra: Record<string, unknown> = {}) => {
    const req = new Request(`http://localhost/api/places/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ geofenceEnabled: true, ...extra }),
    })
    const res = await placeRoute.PATCH(req as never, { params: Promise.resolve({ placeId: id }) })
    return { status: res.status, json: await res.json() }
  }

  // Plus with 2 alert places: a 3rd is fine, a 4th is refused.
  add(2, true)
  let r = await create(true)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  r = await create(true)
  assert.equal(r.status, 403)
  assert.match(r.json.error, /alerts on 3 places/)
  r = await create(false)
  assert.equal(r.status, 200, "a place without alerts is still fine")
  ok("Plus create: alerts on a 3rd place OK, a 4th refused (403); places without alerts unaffected")

  // Turning alerts on for an existing place: refused while 3 are on.
  const off = places.find((p) => !p.geofence_enabled)!
  r = await turnOn(off.id)
  assert.equal(r.status, 403)
  assert.equal(off.geofence_enabled, false)
  const on = places.find((p) => p.geofence_enabled)!
  r = await turnOn(on.id, { name: "Renamed" })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  ok("Plus edit: turning on a 4th refused; editing a place that already alerts is fine")

  places.find((p) => p.geofence_enabled)!.geofence_enabled = false
  r = await turnOn(off.id)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(off.geofence_enabled, true)
  ok("Plus edit: after turning one off, another can be turned on")

  tier = "PREMIUM_PLUS"
  add(10, true)
  r = await create(true)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  ok("Premium: alerts on every place (13+ on)")

  tier = "FREE"
  places.length = 0
  r = await create(true)
  assert.equal(r.status, 403)
  assert.match(r.json.error, /Plus \(3 places\) or Premium/)
  r = await create(false)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  ok("Free: no alerts (403 with the upgrade message); plain places still saved")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
