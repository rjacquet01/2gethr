// Usage: npx tsx --tsconfig tsconfig.json scripts/test-kid-ping.ts
// A parent pings their child's location with no approval, even while the
// child's sharing is off: through the real /api/location/request,
// /api/location/request/[id] and /api/location handlers, on a small stateful
// in-memory database (lib/db __setSqlForTests). Nothing touches a real
// database: DATABASE_URL points at a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "kid-ping-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "kid-ping-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "kid-ping-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
delete process.env.RESEND_API_KEY

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake database rows
type Row = Record<string, any>

const FAMILY = "fam-1"
const PARENT = "u-parent"
const ADULT = "u-adult"
const CHILD = "u-child"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const requestRoute = await import("../app/api/location/request/route")
  const answerRoute = await import("../app/api/location/request/[id]/route")
  const location = await import("../app/api/location/route")

  // ---- stateful fake database ------------------------------------------------------------------
  let db!: { members: Row[]; requests: Row[]; notifications: Row[]; pings: Row[] }
  const fresh = (childSharing: boolean) => {
    const member = (user_id: string, role: string, share = false) => ({
      id: `m-${user_id.slice(2)}`, family_id: FAMILY, user_id, role, is_active: true,
      mode: share ? "ACTIVE" : "OFF", share_with_family: share,
    })
    db = {
      members: [member(PARENT, "PARENT", true), member(ADULT, "ADULT", true), member(CHILD, "CHILD", childSharing)],
      requests: [], notifications: [], pings: [],
    }
  }
  const memberOf = (userId: unknown) => db.members.find((m) => m.user_id === userId)
  const memberById = (id: unknown) => db.members.find((m) => m.id === id)
  const live = (r: Row) => r.expires_at > Date.now()

  const handlers: [string, (v: unknown[], q: string) => Row[]][] = [
    ["pg_get_constraintdef", () => [{ def: "AWAITING_APPROVAL CANCELLED" }]],
    ["FROM users WHERE id =", (v) => [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: String(v[0]).slice(2), last_name: "", is_active: true }]],
    ["COUNT(*) FILTER (WHERE role = 'GUEST')", (v) => [{ guest: 0, total: memberOf(v[0]) ? 1 : 0 }]],
    ["AND role = 'GUEST'", () => []],
    ["SELECT tier, status, trial_ends_at", () => [{ tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null }]],
    // POST /api/location/request: requester + target membership.
    ["target.nickname as target_name", (v) => {
      const target = memberById(v[0])
      const me = memberOf(v[2])
      return target && me ? [{ role: me.role, requester_user_id: me.user_id, target_member_id: target.id, target_user_id: target.user_id, target_role: target.role, target_name: null }] : []
    }],
    ["SELECT created_at FROM location_requests", () => []],
    ["SELECT 1 FROM location_settings WHERE family_member_id", (v) => {
      const m = memberById(v[0])
      return m && m.mode === "ACTIVE" && m.share_with_family ? [{ "?column?": 1 }] : []
    }],
    ["INSERT INTO location_requests", (v, q) => {
      db.requests.push({ id: v[0], requester_user_id: v[1], target_user_id: v[2], family_id: v[3], status: q.includes("'PENDING'") ? "PENDING" : "AWAITING_APPROVAL", expires_at: Date.now() + 10 * 60_000 })
      return []
    }],
    ["INSERT INTO notifications", (v) => { db.notifications.push({ user_id: v[1], title: v[2], body: v[3] }); return [] }],
    // GET /api/location/request: open requests for this user, with their sharing.
    ["FROM location_requests lr JOIN users u", (v) => db.requests
      .filter((r) => r.target_user_id === v[0] && r.status === v[1] && live(r) && !String(r.requester_user_id).startsWith("legal:"))
      .map((r) => {
        const m = memberOf(r.target_user_id)!
        return { ...r, first_name: String(r.requester_user_id).slice(2), last_name: "", created_at: new Date(), sharing: m.mode === "ACTIVE" && m.share_with_family }
      })],
    ["SELECT 1 FROM location_requests WHERE target_user_id", (v) => db.requests.filter((r) => r.target_user_id === v[0] && r.status === "PENDING" && live(r))],
    // POST /api/location/request/[id]
    ["SELECT id, requester_user_id, target_user_id, family_id, status, expires_at FROM location_requests WHERE id", (v) =>
      db.requests.filter((r) => r.id === v[0]).map((r) => ({ ...r, expires_at: new Date(r.expires_at) }))],
    // answerLocationRequests: (lat, lng, accuracy, userId, requestId, requestId)
    ["SET status = 'FULFILLED', fulfilled_at = NOW(), snapshot_lat", (v) => {
      const hits = db.requests.filter((r) => r.target_user_id === v[3] && r.status === "PENDING" && live(r) &&
        !String(r.requester_user_id).startsWith("legal:") && (v[4] == null || r.id === v[5]))
      for (const r of hits) Object.assign(r, { status: "FULFILLED", snapshot_lat: v[0], snapshot_lng: v[1], snapshot_accuracy: v[2] })
      return hits.map((r) => ({ id: r.id }))
    }],
    // POST /api/location: the sender's own settings.
    ["SELECT ls.mode, ls.share_with_family, fm.family_id", (v) => {
      const m = memberOf(v[v.length - 1])
      return m ? [{ mode: m.mode, share_with_family: m.share_with_family, family_id: FAMILY, member_id: m.id, role: m.role, is_owner: m.user_id === PARENT }] : []
    }],
    ["INSERT INTO location_pings", (v) => { db.pings.push({ id: v[0], user_id: v[1] }); return [] }],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v, q)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const tokens: Record<string, string> = {}
  for (const u of [PARENT, ADULT, CHILD]) tokens[u] = await generateAccessToken(u)
  const auth = (userId: string) => ({ "content-type": "application/json", authorization: `Bearer ${tokens[userId]}` })
  const ping = (from: string, to: string) =>
    requestRoute.POST(new NextRequest("http://localhost/api/location/request", {
      method: "POST", headers: auth(from), body: JSON.stringify({ familyId: FAMILY, memberId: memberOf(to)!.id }),
    }))
  const openRequests = (userId: string) =>
    requestRoute.GET(new NextRequest("http://localhost/api/location/request", { headers: auth(userId) }))
  const answer = (userId: string, id: string, body: Row) =>
    answerRoute.POST(new NextRequest(`http://localhost/api/location/request/${id}`, { method: "POST", headers: auth(userId), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })
  const fix = (userId: string) =>
    location.POST(new NextRequest("http://localhost/api/location", {
      method: "POST", headers: auth(userId), body: JSON.stringify({ latitude: 41.5, longitude: -81.69, accuracy: 20 }),
    }))
  const realError = console.error
  const quiet = async <T,>(fn: () => Promise<T>) => { console.error = () => {}; try { return await fn() } finally { console.error = realError } }

  console.log("parent pings a child whose sharing is off")
  fresh(false)
  let res: Response = await quiet(() => ping(PARENT, CHILD))
  let body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.status, "PENDING", "no approval step")
  assert.equal(db.requests[0].status, "PENDING")
  ok("the request is open for the phone right away (PENDING, not AWAITING_APPROVAL)")
  assert.match(db.notifications[0]?.body ?? "", /checked where you are/)
  assert.match(db.notifications[0].body, /sharing is still off/)
  assert.equal(db.notifications[0].user_id, CHILD)
  ok("the child is told, in-app, that a parent checked")

  res = await openRequests(CHILD)
  body = await res.json()
  assert.equal(body.freshFixWanted, true)
  assert.equal(body.data.length, 1)
  assert.equal(body.data[0].answerWith, "snapshot")
  ok("the child's app sees it, to answer with a snapshot")

  const id = db.requests[0].id
  res = await answer(CHILD, id, { action: "answer", latitude: 41.5, longitude: -81.69, accuracy: 15 })
  assert.equal(res.status, 200)
  assert.equal(db.requests[0].status, "FULFILLED")
  assert.equal(db.requests[0].snapshot_lat, 41.5)
  assert.equal(db.pings.length, 0, "no live location stored")
  assert.equal(memberOf(CHILD)!.share_with_family, false)
  ok("the answer is a snapshot for the parent; nothing live, sharing still off")
  res = await answer(CHILD, id, { action: "answer", latitude: 1, longitude: 1 })
  assert.equal(res.status, 409)
  ok("an answered ping can't be answered again")
  res = await answer(ADULT, id, { action: "answer", latitude: 1, longitude: 1 })
  assert.equal(res.status, 404)
  ok("nobody else can answer the child's ping")

  console.log("a phone answers with a normal fix (the Android path)")
  fresh(false)
  await quiet(() => ping(PARENT, CHILD))
  res = await quiet(() => fix(CHILD))
  body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.answeredRequests, 1)
  assert.equal(body.data.stored, false)
  assert.equal(db.pings.length, 0)
  assert.equal(db.requests[0].status, "FULFILLED")
  ok("a fix from a non-sharing child answers the open ping, stored as a snapshot only")
  res = await quiet(() => fix(CHILD))
  assert.equal(res.status, 400)
  ok("with no ping open, a non-sharing child's fix is still refused")

  console.log("legal requests are never answered with a snapshot")
  fresh(false)
  db.requests.push({ id: "legal-1", requester_user_id: "legal:case-1", target_user_id: CHILD, family_id: FAMILY, status: "PENDING", expires_at: Date.now() + 600_000 })
  res = await quiet(() => fix(CHILD))
  assert.equal(res.status, 400)
  assert.equal(db.requests[0].status, "PENDING")
  ok("a legal request stays open (it needs live sharing)")

  console.log("everyone else still needs approval")
  fresh(false)
  res = await quiet(() => ping(ADULT, CHILD))
  body = await res.json()
  assert.equal(body.data.status, "AWAITING_APPROVAL")
  ok("an ADULT (not a parent) pinging a child: approval needed")
  fresh(false)
  res = await quiet(() => ping(PARENT, ADULT))
  body = await res.json()
  assert.equal(body.data.status, "AWAITING_APPROVAL")
  ok("a parent pinging another grown-up: approval needed")
  fresh(false)
  res = await quiet(() => ping(CHILD, PARENT))
  body = await res.json()
  assert.equal(body.data.status, "AWAITING_APPROVAL")
  ok("a child pinging a parent: approval needed")

  console.log("parent pings a child who is sharing")
  fresh(true)
  res = await quiet(() => ping(PARENT, CHILD))
  body = await res.json()
  assert.equal(body.data.status, "PENDING")
  assert.match(db.notifications[0].title, /Location refreshed/)
  res = await openRequests(CHILD)
  body = await res.json()
  assert.equal(body.data[0].answerWith, "live")
  ok("no approval, and the phone answers with its live fix")

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
