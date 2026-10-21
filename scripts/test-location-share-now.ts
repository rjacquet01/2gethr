// Usage: npx tsx --tsconfig tsconfig.json scripts/test-location-share-now.ts
// "Share now" (a one-time location share, once: true) through the real
// POST/GET /api/location handlers, on a small stateful in-memory database
// (lib/db __setSqlForTests). Nothing touches a real database: DATABASE_URL
// points at a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "share-now-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "share-now-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "share-now-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>

const FAMILY = "fam-1"
const OWNER = "u-owner"   // family owner, PARENT
const ADULT = "u-adult"   // ADULT member
const CHILD = "u-child"   // child's own login
const GUEST = "u-guest"
const HOME = { latitude: 42.3601, longitude: -71.0589 }
const AWAY = { latitude: 42.4, longitude: -71.2 } // ~14 km from home

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const { isOneTimePingId } = await import("../lib/location-dedupe")
  const location = await import("../app/api/location/route")

  // ---- stateful fake database ------------------------------------------------------------------
  let db!: { members: Row[]; pings: Row[]; geofenceEvents: Row[]; writes: string[] }
  const fresh = (mode = "OFF", share = false) => {
    const member = (user_id: string, role: string) => ({
      id: `m-${user_id.slice(2)}`, family_id: FAMILY, user_id, role, is_active: true, mode, share_with_family: share,
    })
    db = {
      members: [member(OWNER, "PARENT"), member(ADULT, "ADULT"), member(CHILD, "CHILD"), member(GUEST, "GUEST")],
      pings: [],
      // Arrived home a week ago: a stale state a one-off fix must not act on.
      geofenceEvents: [{ saved_place_id: "place-home", event_type: "ARRIVAL", timestamp: new Date(Date.now() - 7 * 86400_000) }],
      writes: [],
    }
  }
  const memberOf = (userId: unknown) => db.members.find((m) => m.user_id === userId)
  const latestPing = (userId: unknown) =>
    db.pings.filter((p) => p.user_id === userId).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0]

  const handlers: [string, (v: unknown[]) => Row[]][] = [
    ["pg_get_constraintdef", () => [{ def: "AWAITING_APPROVAL CANCELLED" }]],
    ["FROM users WHERE id =", (v) => [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: String(v[0]).slice(2), last_name: "", is_active: true }]],
    ["SELECT first_name FROM users", (v) => [{ first_name: String(v[0]).slice(2) }]],
    ["FROM family_members fm JOIN families f ON fm.family_id = f.id WHERE fm.user_id", (v) => {
      const m = memberOf(v[0])
      return m ? [{ member_id: m.id, role: m.role, family_id: FAMILY, family_name: "The Testers", owner_id: OWNER }] : []
    }],
    ["COUNT(*) FILTER (WHERE role = 'GUEST')", (v) => {
      const m = memberOf(v[0])
      return [{ guest: m?.role === "GUEST" ? 1 : 0, total: m ? 1 : 0 }]
    }],
    ["AND role = 'GUEST'", (v) => (memberOf(v[1])?.role === "GUEST" ? [{ "?column?": 1 }] : [])],
    ["SELECT ls.mode, ls.share_with_family, fm.family_id", (v) => {
      // (memberId, ownerCheckUserId, familyId, userId) or (ownerCheckUserId, userId)
      const userId = v[v.length - 1]
      const m = memberOf(userId)
      if (!m || m.role === "GUEST") return []
      return [{ mode: m.mode, share_with_family: m.share_with_family, family_id: FAMILY, member_id: m.id, role: m.role, is_owner: userId === OWNER }]
    }],
    ["SELECT tier, status, trial_ends_at", () => [{ tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null }]],
    ["SELECT id, latitude, longitude, accuracy, battery_level, timestamp FROM location_pings", (v) => {
      const p = latestPing(v[0])
      return p ? [p] : []
    }],
    ["FROM saved_places sp WHERE sp.family_id", () => [{
      id: "place-home", name: "Home", ...HOME, radius: 150, alert_on_arrival: true, alert_on_departure: true, notify_channels: ["in_app"],
    }]],
    ["SELECT DISTINCT ON (ge.saved_place_id)", () => {
      const last = [...db.geofenceEvents].sort((a, b) => b.timestamp - a.timestamp)[0]
      return last ? [last] : []
    }],
    ["INSERT INTO geofence_events", (v) => {
      db.geofenceEvents.push({ saved_place_id: v[2], event_type: v[3], timestamp: new Date() })
      return [{ id: v[0] }]
    }],
    ["INSERT INTO location_pings", (v) => {
      db.pings.push({ id: v[0], user_id: v[1], latitude: v[2], longitude: v[3], accuracy: v[4], battery_level: v[8], timestamp: v[9] })
      return []
    }],
    ["UPDATE location_pings", (v) => {
      const p = db.pings.find((x) => x.id === v[2])
      if (p) p.timestamp = v[0]
      return []
    }],
    // GET: the viewer's membership, then everyone with their latest ping.
    ["SELECT id, role FROM family_members", (v) => {
      const m = memberOf(v[1])
      return m ? [{ id: m.id, role: m.role }] : []
    }],
    ["SELECT role FROM family_members", (v) => {
      const m = memberOf(v[1])
      return m ? [{ role: m.role }] : []
    }],
    ["COALESCE(ls.mode, 'OFF') as location_mode", () => db.members.map((m) => {
      const p = latestPing(m.user_id)
      return {
        member_id: m.id, user_id: m.user_id, role: m.role, nickname: m.user_id.slice(2),
        location_mode: m.mode, share_with_family: m.share_with_family,
        ping_id: p?.id ?? null, latitude: p?.latitude ?? null, longitude: p?.longitude ?? null, timestamp: p?.timestamp ?? null,
      }
    })],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) db.writes.push(q)
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const tokens: Record<string, string> = {}
  for (const u of [OWNER, ADULT, CHILD, GUEST]) tokens[u] = await generateAccessToken(u)
  const post = (userId: string, body: Row) =>
    location.POST(new NextRequest("http://localhost/api/location", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[userId]}` },
      body: JSON.stringify({ memberId: memberOf(userId)!.id, familyId: FAMILY, ...body }),
    }))
  const get = (userId: string) =>
    location.GET(new NextRequest(`http://localhost/api/location?familyId=${FAMILY}`, {
      headers: { authorization: `Bearer ${tokens[userId]}` },
    }))
  const realError = console.error
  const quiet = async <T,>(fn: () => Promise<T>) => { console.error = () => {}; try { return await fn() } finally { console.error = realError } }
  const settingsWrites = () => db.writes.filter((q) => q.includes("location_settings"))

  // 1. A grown-up with sharing off can share once; the setting stays off.
  console.log("adult one-time share")
  for (const who of [OWNER, ADULT]) {
    fresh("OFF", false)
    const r = await quiet(() => post(who, { ...AWAY, accuracy: 10, batteryLevel: 10, once: true }))
    assert.strictEqual(r.status, 200, `${who}: ${JSON.stringify(await r.clone().json())}`)
    const pingId = (await r.json()).data.pingId
    assert.strictEqual(db.pings.length, 1, "one fix stored")
    assert.ok(isOneTimePingId(pingId, memberOf(who)!.id), "stored as a one-time share from this membership")
    assert.deepStrictEqual(settingsWrites(), [], "saved settings untouched")
    assert.strictEqual(memberOf(who)!.mode, "OFF")
    assert.strictEqual(db.geofenceEvents.length, 1, "no geofence event from a one-off fix")
    assert.ok(!db.writes.some((q) => q.includes("INSERT INTO notifications")), "no geofence or low-battery alert")
  }
  ok("owner and ADULT with sharing OFF: once is accepted, settings unchanged, no geofence/battery alerts")

  {
    fresh("PAUSED", true)
    const r = await quiet(() => post(ADULT, { ...AWAY, once: true }))
    assert.strictEqual(r.status, 200)
    assert.deepStrictEqual(settingsWrites(), [])
    ok("adult with sharing PAUSED: once is accepted, settings unchanged")
  }

  // 2. The family sees that one fix for a while, without sharing being on.
  console.log("visibility")
  {
    fresh("OFF", false)
    await quiet(() => post(ADULT, { ...AWAY, once: true }))
    let body = await (await get(CHILD)).json()
    assert.deepStrictEqual(body.data.map((l: Row) => l.memberId), [memberOf(ADULT)!.id], "the shared fix is on the map")
    assert.strictEqual(body.data[0].location.latitude, AWAY.latitude)

    // An hour later it is gone again.
    db.pings[0].timestamp = new Date(Date.now() - 61 * 60_000).toISOString()
    body = await (await get(CHILD)).json()
    assert.deepStrictEqual(body.data, [], "hidden after an hour")
    ok("a one-time share shows on the family map for an hour, then disappears (sharing still off)")
  }

  // 3. A child with sharing off can't share, not even once.
  console.log("child and guest")
  {
    fresh("OFF", false)
    let r = await quiet(() => post(CHILD, { ...AWAY, once: true }))
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /disabled/)
    fresh("PAUSED", true)
    r = await quiet(() => post(CHILD, { ...AWAY, once: true }))
    assert.strictEqual(r.status, 400)
    assert.strictEqual(db.pings.length, 0, "nothing stored")
    ok("child with sharing OFF or PAUSED: once is refused, nothing stored")

    fresh("OFF", false)
    r = await quiet(() => post(GUEST, { ...AWAY, once: true }))
    assert.strictEqual(r.status, 403)
    fresh("ACTIVE", true)
    r = await quiet(() => post(GUEST, { ...AWAY, once: true }))
    assert.strictEqual(r.status, 403)
    assert.strictEqual(db.pings.length, 0)
    ok("guest is refused (403), with or without once")
  }

  // 4. Normal updates are unchanged.
  console.log("normal updates")
  {
    fresh("OFF", false)
    let r = await quiet(() => post(ADULT, { ...AWAY }))
    assert.strictEqual(r.status, 400)
    r = await quiet(() => post(OWNER, { ...AWAY, once: false }))
    assert.strictEqual(r.status, 400)
    assert.strictEqual(db.pings.length, 0)
    ok("without once, an update is still refused while sharing is OFF")

    fresh("ACTIVE", true)
    r = await quiet(() => post(CHILD, { ...AWAY, accuracy: 10 }))
    assert.strictEqual(r.status, 200)
    assert.strictEqual(db.pings.length, 1)
    assert.ok(!isOneTimePingId(db.pings[0].id), "an ordinary row")
    assert.deepStrictEqual(db.geofenceEvents.map((e) => e.event_type), ["ARRIVAL", "DEPARTURE"], "geofences evaluated as before")
    r = await quiet(() => post(CHILD, { ...AWAY, accuracy: 10 }))
    assert.strictEqual(r.status, 200)
    assert.strictEqual(db.pings.length, 1, "a still phone's repeat is merged (dedupe unchanged)")
    ok("with sharing ACTIVE a normal update is stored, geofences run, repeats are merged")

    // A one-time row is never extended by later fixes.
    fresh("ACTIVE", true)
    const at = (agoMs: number) => new Date(Date.now() - agoMs).toISOString()
    await quiet(() => post(ADULT, { ...AWAY, timestamp: at(2000) }))
    memberOf(ADULT)!.mode = "OFF"
    await quiet(() => post(ADULT, { ...AWAY, timestamp: at(1000), once: true }))
    memberOf(ADULT)!.mode = "ACTIVE"
    await quiet(() => post(ADULT, { ...AWAY, timestamp: at(0) }))
    assert.strictEqual(db.pings.length, 3, "the fix after a one-time share is not merged into it")
    ok("a one-time row is never merged into")
  }

  __setSqlForTests(null)
  console.log(`\nAll ${passed} share-now checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
