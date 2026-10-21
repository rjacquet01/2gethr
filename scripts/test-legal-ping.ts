// Usage: npx tsx --tsconfig tsconfig.json scripts/test-legal-ping.ts
// Legal live pings and case data, through the real routes, on an in-memory
// fake database (lib/db __setSqlForTests). DATABASE_URL points at a closed
// local port, so nothing touches a real database.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "legal-ping-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "legal-ping-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "legal-ping-test-admin-secret-not-real-0123456789"
delete process.env.RESEND_API_KEY

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>
const CASE = "case-1"
const FAMILY = "fam-1"
const MOM = "u-mom"
const KID = "u-kid"
const OUTSIDER = "u-outsider"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const { collectUserExport } = await import("../lib/data-export")
  const { collect } = await import("../lib/legal-data")
  const { NextRequest } = await import("next/server")
  const pingRoute = await import("../app/api/admin/legal/[caseId]/ping/route")
  const requestRoute = await import("../app/api/location/request/route")

  const now = Date.now()
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  let legalCase: Row = {}
  let requests: Row[] = []
  const log: { q: string; v: unknown[] }[] = []
  const fresh = () => {
    log.length = 0
    legalCase = {
      id: CASE, case_number: "LR-2026-0001", type: "WARRANT", status: "APPROVED",
      scope_family_id: FAMILY, scope_user_id: null, includes_live_ping: true,
      // The warrant covers last month; pings happen now, after that range.
      scope_from: iso(40 * 86400_000), scope_to: iso(10 * 86400_000),
      access_expires_at: iso(-3600_000),
    }
    requests = [
      // Answered 5 minutes ago, unanswered and expired, still waiting; plus a parent's ordinary ping.
      { id: "locreq_legal_1", requester_user_id: `legal:${CASE}`, target_user_id: KID, status: "FULFILLED", created_at: iso(6 * 60_000), fulfilled_at: iso(5 * 60_000), expires_at: iso(-9 * 60_000),
        latitude: 40.1, longitude: -74.2, accuracy: 12, battery_level: 55, fix_at: iso(5 * 60_000) },
      { id: "locreq_legal_2", requester_user_id: `legal:${CASE}`, target_user_id: MOM, status: "PENDING", created_at: iso(3 * 3600_000), fulfilled_at: null, expires_at: iso(3 * 3600_000 - 15 * 60_000) },
      { id: "locreq_legal_3", requester_user_id: `legal:${CASE}`, target_user_id: KID, status: "PENDING", created_at: iso(60_000), fulfilled_at: null, expires_at: iso(-14 * 60_000) },
    ]
  }
  fresh()
  const admins: Record<string, string[]> = { "a-legal": ["legal.manage"], "a-support": ["users.read"] }

  // Databases set up with scripts/create-location-requests-table.sql have a
  // foreign key from requester_user_id to users, which a "legal:" requester breaks.
  let requesterFk = true
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    log.push({ q, v })
    if (q.startsWith("SELECT 1 FROM pg_constraint WHERE conname = 'location_requests_requester_user_id_fkey'")) return requesterFk ? [{ x: 1 }] : []
    if (q === "ALTER TABLE location_requests DROP CONSTRAINT IF EXISTS location_requests_requester_user_id_fkey") { requesterFk = false; return [] }
    if (q.startsWith("INSERT INTO location_requests") && requesterFk && String(v[1]).startsWith("legal:")) {
      throw new Error('insert or update on table "location_requests" violates foreign key constraint "location_requests_requester_user_id_fkey"')
    }
    if (/^(CREATE|ALTER|DROP|INSERT INTO admin_|INSERT INTO legal_access_log|INSERT INTO admin_action_logs)/.test(q)) return []
    if (q.includes("FROM admin_users")) return admins[v[0] as string] ? [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "A", last_name: "Admin", status: "ACTIVE", mfa_enabled: true }] : []
    if (q.includes("FROM admin_roles r")) return []
    if (q.includes("SELECT DISTINCT p.key")) return (admins[v[0] as string] ?? []).map((key) => ({ key }))
    if (q.startsWith("SELECT pg_get_constraintdef")) return [{ def: "AWAITING_APPROVAL CANCELLED" }]
    if (q.startsWith("SELECT * FROM legal_cases")) return v[0] === CASE ? [legalCase] : []
    if (q.startsWith("SELECT DISTINCT user_id FROM family_members")) return [{ user_id: MOM }, { user_id: KID }]
    if (q.startsWith("SELECT u.id AS user_id, u.first_name")) {
      return [{ user_id: KID, first_name: "Kit", last_name: "", sharing: true }, { user_id: MOM, first_name: "Mia", last_name: "", sharing: false }]
    }
    if (q.startsWith("SELECT lr.id, lr.target_user_id")) return requests.filter((r) => r.requester_user_id === v[0])
    if (q.startsWith("SELECT 1 FROM location_requests")) return [] // no recent ping
    if (q.startsWith("SELECT fm.family_id, ls.mode")) return [{ family_id: FAMILY, mode: "ACTIVE", share_with_family: true }]
    if (q.startsWith("INSERT INTO location_requests")) return []
    // The device's own check: real users only (legal requester has no users row).
    if (q.startsWith("SELECT lr.*, u.first_name")) return []
    if (q.startsWith("SELECT 1 FROM location_requests WHERE target_user_id")) return []
    if (q.includes("FROM users") && q.includes("WHERE id =")) {
      return [KID, MOM].includes(v[0] as string) ? [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "X", is_active: true }] : []
    }
    if (q.startsWith("SELECT 1 FROM family_members fm WHERE fm.user_id")) return []
    if (q.includes("FILTER (WHERE role = 'GUEST')")) return [{ guest: 0, total: 1 }]
    if (q.includes("FROM emergency_alerts")) throw new Error('relation "emergency_alerts" does not exist')
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const quiet = async <T,>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }
  const adminReq = async (as: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost/api/admin/legal/${CASE}/ping`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await generateAdminAccessToken({ id: as, email: `${as}@example.invalid`, firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: true, roles: [], permissions: admins[as] } as never)}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const ctx = { params: Promise.resolve({ caseId: CASE }) }

  // Runs first: ensureLocationRequestsTable() is memoized per process.
  console.log("requester foreign key")
  {
    const r = await quiet(async () => pingRoute.POST(await adminReq("a-legal", "POST", { userId: KID }), ctx))
    assert.strictEqual(r.status, 200, "ping saved despite the old foreign key")
    assert.strictEqual(requesterFk, false)
    const at = (needle: string) => log.findIndex((x) => x.q.startsWith(needle))
    assert.ok(at("ALTER TABLE location_requests DROP CONSTRAINT IF EXISTS location_requests_requester_user_id_fkey") < at("INSERT INTO location_requests"))
    const drops = log.filter((x) => /DROP CONSTRAINT/.test(x.q)).map((x) => x.q)
    assert.deepStrictEqual(drops, ["ALTER TABLE location_requests DROP CONSTRAINT IF EXISTS location_requests_requester_user_id_fkey"])
    ok("the requester foreign key is dropped before the ping is saved; no other constraint touched")
  }

  console.log("ping results")
  {
    const r = await quiet(async () => pingRoute.GET(await adminReq("a-legal", "GET"), ctx))
    assert.strictEqual(r.status, 200)
    const d = (await r.json()).data
    assert.deepStrictEqual(d.people.map((p: Row) => [p.name, p.sharing]), [["Kit", true], ["Mia", false]])
    assert.deepStrictEqual(d.pings.map((p: Row) => p.status), ["FULFILLED", "NO_ANSWER", "PENDING"])
    assert.deepStrictEqual(d.pings[0].fix, { latitude: 40.1, longitude: -74.2, accuracy: 12, batteryLevel: 55, at: requests[0].fix_at })
    ok("answers show even though they fall after the case's date range; unanswered ones say so")
    assert.ok(log.some((x) => x.q.startsWith("INSERT INTO legal_access_log") && x.v.includes("PING_RESULTS_VIEWED")), "viewing is logged")
    ok("viewing ping results is logged")

    legalCase.access_expires_at = iso(60_000)
    const closed = await quiet(async () => pingRoute.GET(await adminReq("a-legal", "GET"), ctx))
    assert.strictEqual(closed.status, 403)
    const noPerm = await quiet(async () => pingRoute.GET(await adminReq("a-support", "GET"), ctx))
    assert.strictEqual(noPerm.status, 403)
    ok("no results once the access window closes, or without the legal permission")
  }

  console.log("choosing who to ping")
  {
    fresh()
    const r = await quiet(async () => pingRoute.POST(await adminReq("a-legal", "POST", { userId: MOM }), ctx))
    assert.strictEqual(r.status, 200)
    const ins = log.find((x) => x.q.startsWith("INSERT INTO location_requests"))!
    assert.deepStrictEqual([ins.v[1], ins.v[2]], [`legal:${CASE}`, MOM])
    ok("the chosen person is pinged (not just the first in the family)")

    fresh()
    const out = await quiet(async () => pingRoute.POST(await adminReq("a-legal", "POST", { userId: OUTSIDER }), ctx))
    assert.strictEqual(out.status, 400)
    assert.ok(!log.some((x) => x.q.startsWith("INSERT INTO location_requests")))
    ok("someone outside the case can't be pinged")
  }

  console.log("the pinged person's side")
  {
    fresh()
    // A legal ping is waiting: the device check says so, without any detail.
    const pendingAny = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
      const q = strings.join("?").replace(/\s+/g, " ").trim()
      if (q.startsWith("SELECT 1 FROM location_requests WHERE target_user_id")) return [{ x: 1 }]
      return (fake as any)(strings, ...v)
    }) as unknown as Parameters<typeof __setSqlForTests>[0]
    __setSqlForTests(pendingAny)
    const req = new NextRequest("http://localhost/api/location/request", { headers: { authorization: `Bearer ${await generateAccessToken(KID)}` } })
    const r = await quiet(() => requestRoute.GET(req))
    const body = await r.json()
    __setSqlForTests(fake)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(body.freshFixWanted, true)
    assert.deepStrictEqual(body.data, [])
    assert.ok(!JSON.stringify(body).includes("legal"), "nothing about the case reaches the device")
    ok("the app is told to send a fresh fix, with nothing about who asked")

    log.length = 0
    await quiet(() => collectUserExport(KID))
    const exp = log.find((x) => x.q.includes("FROM location_requests"))!
    assert.ok(exp.q.includes("NOT LIKE 'legal:%'"))
    ok("the person's own data export leaves legal pings out")
  }

  console.log("other case data")
  {
    fresh()
    log.length = 0
    const devices = await collect(legalCase, "devices")
    const qs = log.map((x) => x.q)
    assert.ok(qs.every((q) => !/\btoken\b|token_hash/.test(q.split("FROM")[0])), "no token values or hashes selected")
    assert.ok(log.filter((x) => /FROM (refresh_tokens|login_attempts)/.test(x.q)).every((x) => x.v.includes(legalCase.scope_to)), "sessions limited to the date range")
    assert.ok(log.filter((x) => x.q.includes("ANY(")).every((x) => JSON.stringify(x.v).includes(KID)), "limited to the case's people")
    assert.deepStrictEqual(Object.keys(devices.rows[0]), ["sessions", "signIns", "pushDevices", "locationDevices"])
    ok("devices & IPs: sessions and sign-ins in range, devices; never tokens")

    const safety = await collect(legalCase, "safety")
    assert.deepStrictEqual(safety.rows[0].emergencyAlerts, [])
    ok("SOS & emergencies works where the emergency alerts table hasn't been created yet")

    log.length = 0
    await collect(legalCase, "places")
    await collect(legalCase, "billing")
    assert.ok(log.filter((x) => /FROM (saved_places|families|subscriptions)/.test(x.q)).every((x) => JSON.stringify(x.v).includes(FAMILY)))
    assert.ok(!log.some((x) => /card|last4/i.test(x.q)), "no card details")
    ok("saved places and subscriber/billing records are limited to the case's family")
  }

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
