// Usage: npx tsx --tsconfig tsconfig.json scripts/test-adult-location-access.ts
// Grown-ups see kids without sharing; grown-ups see each other only after
// approval. Real routes on an in-memory fake database (lib/db
// __setSqlForTests): DATABASE_URL points at a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "adult-loc-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "adult-loc-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "adult-loc-test-admin-secret-not-real-0123456789"
delete process.env.RESEND_API_KEY
delete process.env.FIREBASE_PROJECT_ID
delete process.env.TWILIO_ACCOUNT_SID

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>
const FAMILY = "fam-1"
const MOM = "u-mom" // PARENT, not sharing
const DAD = "u-dad" // PARENT, sharing
const AUNT = "u-aunt" // ADULT, sharing
const KID = "u-kid" // CHILD, sharing

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const locationRoute = await import("../app/api/location/route")
  const historyRoute = await import("../app/api/location/history/route")
  const accessRoute = await import("../app/api/location/access/route")
  const { locationAudienceUserIds } = await import("../lib/location-access")
  const { alertFamilyAdults } = await import("../lib/family-alerts")
  const { oneTimePingId } = await import("../lib/location-dedupe")

  const members: Row[] = [
    { id: "m-mom", family_id: FAMILY, user_id: MOM, role: "PARENT", is_active: true, first_name: "Mia" },
    { id: "m-dad", family_id: FAMILY, user_id: DAD, role: "PARENT", is_active: true, first_name: "Dan" },
    { id: "m-aunt", family_id: FAMILY, user_id: AUNT, role: "ADULT", is_active: true, first_name: "Ada" },
    { id: "m-kid", family_id: FAMILY, user_id: KID, role: "CHILD", is_active: true, first_name: "Kit" },
  ]
  const sharing: Record<string, boolean> = { "m-mom": false, "m-dad": true, "m-aunt": true, "m-kid": true }
  let pingIds: Record<string, string> = {}
  let grants: Row[] = []
  const log: { q: string; v: unknown[] }[] = []
  const unknown = new Set<string>()
  const byUser = (f: string, u: unknown) => members.find((m) => m.family_id === f && m.user_id === u && m.is_active)

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    log.push({ q, v })
    if (/^(CREATE|ALTER)/.test(q)) return []
    if (q.includes("FROM users") && q.includes("WHERE id =")) {
      const m = members.find((x) => x.user_id === v[0])
      return m ? [{ id: m.user_id, email: `${m.user_id}@example.invalid`, first_name: m.first_name, last_name: "", is_active: true }] : []
    }
    if (q.includes("FROM subscriptions")) return [{ tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null }]
    if (/^SELECT (id, )?role FROM family_members/.test(q) || q.startsWith("SELECT id, role FROM family_members")) {
      const m = byUser(v[0] as string, v[1])
      return m ? [{ id: m.id, role: m.role }] : []
    }
    // GET /api/location: every member with settings and newest ping.
    if (q.startsWith("SELECT fm.id as member_id")) {
      return members.filter((m) => m.family_id === v[0] && m.is_active).map((m) => ({
        member_id: m.id, user_id: m.user_id, nickname: null, role: m.role, color: null, emoji: null,
        location_mode: sharing[m.id] ? "ACTIVE" : "OFF", share_with_family: sharing[m.id],
        ping_id: pingIds[m.id] ?? `ping-${m.id}`, latitude: 1, longitude: 2, accuracy: 5, altitude: null,
        speed: null, heading: null, battery_level: 80, timestamp: new Date().toISOString(),
        first_name: m.first_name, last_name: "", profile_photo_path: null, child_display_name: null,
      }))
    }
    // Grants.
    if (q.startsWith("SELECT owner_member_id FROM location_access_grants")) {
      return grants.filter((g) => g.viewer_member_id === v[0] && g.status === "APPROVED")
    }
    if (q.startsWith("SELECT 1 FROM location_access_grants")) {
      return grants.filter((g) => g.owner_member_id === v[0] && g.viewer_member_id === v[1] && g.status === "APPROVED").map(() => ({ x: 1 }))
    }
    if (q.startsWith("SELECT fm.user_id FROM location_access_grants")) {
      return grants
        .filter((g) => g.owner_member_id === v[0] && g.status === "APPROVED")
        .map((g) => ({ user_id: members.find((m) => m.id === g.viewer_member_id)!.user_id }))
    }
    if (q.startsWith("INSERT INTO location_access_grants")) {
      const [id, family_id, owner_member_id, viewer_member_id] = v as string[]
      if (grants.some((g) => g.owner_member_id === owner_member_id && g.viewer_member_id === viewer_member_id)) return []
      grants.push({ id, family_id, owner_member_id, viewer_member_id, status: "PENDING" })
      return [{ id }]
    }
    if (q.startsWith("UPDATE location_access_grants")) {
      const g = grants.find((x) => x.owner_member_id === v[0] && x.viewer_member_id === v[1] && x.status === "PENDING")
      if (!g) return []
      g.status = "APPROVED"
      return [{ id: g.id }]
    }
    if (q.startsWith("DELETE FROM location_access_grants")) {
      const revokeAny = q.includes("OR status") ? v[2] === true : true
      grants = grants.filter((g) => !(
        g.owner_member_id === v[0] && g.viewer_member_id === v[1] && (revokeAny || g.status === "PENDING")
      ))
      return []
    }
    // Access route: the other member, and the people list.
    if (q.startsWith("SELECT fm.id, fm.user_id, fm.role FROM family_members")) {
      const m = members.find((x) => x.id === v[0] && x.family_id === v[1] && x.is_active)
      return m ? [m] : []
    }
    if (q.startsWith("SELECT fm.id AS member_id, fm.nickname")) {
      const me = v[0] as string
      return members
        .filter((m) => m.family_id === v[2] && m.id !== v[3] && ["PARENT", "GUARDIAN", "ADULT"].includes(m.role))
        .map((m) => ({
          member_id: m.id, nickname: null, color: null, emoji: null, first_name: m.first_name, last_name: "",
          i_can_see: grants.find((g) => g.owner_member_id === m.id && g.viewer_member_id === me)?.status ?? null,
          they_can_see: grants.find((g) => g.owner_member_id === me && g.viewer_member_id === m.id)?.status ?? null,
        }))
    }
    // History: the target member.
    if (q.startsWith("SELECT fm.user_id, fm.role, COALESCE")) {
      const m = members.find((x) => x.id === v[0] && x.family_id === v[1] && x.is_active)
      return m ? [{ user_id: m.user_id, role: m.role, share: sharing[m.id], mode: sharing[m.id] ? "ACTIVE" : "OFF" }] : []
    }
    if (q.startsWith("SELECT latitude, longitude, speed")) return [{ latitude: 1, longitude: 2, speed: null, battery_level: 80, timestamp: new Date().toISOString() }]
    // Low-battery style alerts: parents/guardians except the subject.
    if (q.startsWith("SELECT fm.user_id, u.email, u.phone")) {
      return members
        .filter((m) => m.family_id === v[0] && ["PARENT", "GUARDIAN"].includes(m.role) && m.user_id !== v[1])
        .map((m) => ({ user_id: m.user_id, email: null, phone: null, push_enabled: false, sms_enabled: false, email_enabled: false }))
    }
    if (q.startsWith("INSERT INTO notifications")) return []
    if (q.includes("rate_limit")) return [{ count: 1 }]
    if (q.startsWith("SELECT")) unknown.add(q.slice(0, 90))
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const req = async (as: string, method: string, path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${await generateAccessToken(as)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const quiet = async <T,>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }
  const seen = async (as: string) => {
    const r = await quiet(async () => locationRoute.GET(await req(as, "GET", `/api/location?familyId=${FAMILY}`)))
    assert.strictEqual(r.status, 200, `GET as ${as}`)
    return ((await r.json()).data as Row[]).map((d) => d.memberId).sort()
  }
  const access = async (as: string, memberId: string, action: string) => {
    const r = await quiet(async () => accessRoute.POST(await req(as, "POST", "/api/location/access", { familyId: FAMILY, memberId, action })))
    return r.status
  }
  const history = async (as: string, memberId: string) =>
    (await quiet(async () => historyRoute.GET(await req(as, "GET", `/api/location/history?familyId=${FAMILY}&memberId=${memberId}`)))).status

  console.log("live map")
  {
    assert.deepStrictEqual(await seen(MOM), ["m-kid"])
    ok("a parent who isn't sharing still sees the sharing kid, and no other adult")
    assert.deepStrictEqual(await seen(DAD), ["m-dad", "m-kid"])
    ok("a sharing parent sees themselves and the kid, not the sharing adult")
    assert.deepStrictEqual(await seen(AUNT), ["m-aunt"])
    ok("an ADULT sees no sharing grown-up without approval (and no kids, as before)")
    assert.deepStrictEqual(await seen(KID), ["m-aunt", "m-dad"])
    ok("a child still sees the grown-ups who share")

    pingIds = { "m-mom": oneTimePingId(Date.now(), "m-mom") }
    assert.deepStrictEqual(await seen(DAD), ["m-dad", "m-kid"])
    assert.deepStrictEqual(await seen(KID), ["m-aunt", "m-dad", "m-mom"])
    pingIds = {}
    ok("a parent's \"Share now\" reaches the kid but not an unapproved adult")
  }

  console.log("asking and approving")
  {
    assert.strictEqual(await access(MOM, "m-dad", "request"), 200)
    assert.deepStrictEqual(grants.map((g) => [g.owner_member_id, g.viewer_member_id, g.status]), [["m-dad", "m-mom", "PENDING"]])
    assert.ok(log.some((x) => x.q.startsWith("INSERT INTO notifications") && x.v.includes(DAD)), "dad told about the request")
    assert.deepStrictEqual(await seen(MOM), ["m-kid"])
    ok("a request is pending and shows nothing until approved; the other adult is notified")

    assert.strictEqual(await access(MOM, "m-dad", "approve"), 404)
    ok("the requester can't approve their own request")

    assert.strictEqual(await access(DAD, "m-mom", "approve"), 200)
    assert.deepStrictEqual(await seen(MOM), ["m-dad", "m-kid"])
    assert.deepStrictEqual(await seen(DAD), ["m-dad", "m-kid"])
    ok("after approval mom sees dad; it's one-way (dad still doesn't see mom's anything)")

    const r = await quiet(async () => accessRoute.GET(await req(DAD, "GET", `/api/location/access?familyId=${FAMILY}`)))
    const people = (await r.json()).data.people as Row[]
    assert.deepStrictEqual(people.find((p) => p.memberId === "m-mom"), {
      memberId: "m-mom", name: "Mia", color: null, emoji: null, iCanSee: "NONE", theyCanSee: "APPROVED",
    })
    ok("the access list shows each direction separately")

    assert.strictEqual(await history(MOM, "m-dad"), 200)
    assert.strictEqual(await history(DAD, "m-aunt"), 403)
    assert.strictEqual(await history(MOM, "m-kid"), 200)
    assert.strictEqual(await history(AUNT, "m-kid"), 403)
    ok("history: approved adult trail OK, unapproved 403; kids' trail stays parent/guardian-only")

    assert.deepStrictEqual(await locationAudienceUserIds(FAMILY, DAD), [MOM])
    assert.strictEqual(await locationAudienceUserIds(FAMILY, KID), null)
    log.length = 0
    await alertFamilyAdults(FAMILY, DAD, { title: "t", body: "b", onlyUserIds: [MOM] })
    await alertFamilyAdults(FAMILY, AUNT, { title: "t", body: "b", onlyUserIds: [] })
    const told = log.filter((x) => x.q.startsWith("INSERT INTO notifications")).map((x) => x.v[1])
    assert.deepStrictEqual(told, [MOM])
    ok("dad's alerts reach only mom, the aunt's reach nobody, and a kid's audience isn't narrowed")

    assert.strictEqual(await access(DAD, "m-mom", "revoke"), 200)
    assert.deepStrictEqual(await seen(MOM), ["m-kid"])
    assert.strictEqual(await history(MOM, "m-dad"), 403)
    ok("removing access hides dad again (map and history)")

    await access(AUNT, "m-dad", "request")
    assert.strictEqual(await access(DAD, "m-aunt", "deny"), 200)
    assert.deepStrictEqual(grants, [])
    await access(AUNT, "m-dad", "request")
    assert.strictEqual(await access(AUNT, "m-dad", "cancel"), 200)
    assert.deepStrictEqual(grants, [])
    ok("deny and cancel both clear the request")
  }

  console.log("who can take part")
  {
    assert.strictEqual(await access(KID, "m-dad", "request"), 403)
    assert.strictEqual(await access(MOM, "m-kid", "request"), 404)
    assert.strictEqual(await access(MOM, "m-mom", "request"), 404)
    assert.deepStrictEqual(grants, [])
    ok("kids can't use it, kids can't be targets, and you can't ask yourself")
  }

  if (unknown.size) console.log("unhandled queries:\n  " + [...unknown].join("\n  "))
  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
