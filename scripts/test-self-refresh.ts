// Usage: npx tsx --tsconfig tsconfig.json scripts/test-self-refresh.ts
// "Share now" inside the Android app (POST /api/location/device-token/refresh):
// Chrome gives the page no location there, so the page asks the phone's own
// background service for a fix. Only for your own member, only with background
// sharing on, at most 10 an hour; it leaves one PENDING request to yourself,
// which the device poll answers. In-memory fake database (lib/db
// __setSqlForTests): no database, no network.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "self-refresh-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "self-refresh-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "self-refresh-test-placeholder-not-used"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Member = { id: string; family_id: string; user_id: string; role: string }
type Req = { id: string; requester: string; target: string; family: string; status: string }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const route = await import("../app/api/location/device-token/refresh/route")

  const members: Member[] = [
    { id: "m-ray", family_id: "fam-a", user_id: "u-ray", role: "PARENT" },
    { id: "m-kid", family_id: "fam-a", user_id: "u-kid", role: "CHILD" },
    { id: "m-guest", family_id: "fam-a", user_id: "u-guest", role: "GUEST" },
  ]
  const activeTokens = new Set<string>(["u-ray|m-ray", "u-guest|m-guest"])
  const requests: Req[] = []

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.includes("FROM users") && q.includes("WHERE id =")) return [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "Test", is_active: true, role: "USER" }]
    if (q.startsWith("SELECT id, role FROM family_members")) {
      return members.filter((m) => m.id === v[0] && m.family_id === v[1] && m.user_id === v[2])
    }
    if (q.startsWith("SELECT created_at, last_used_at FROM location_device_tokens")) {
      return activeTokens.has(`${v[0]}|${v[1]}`) ? [{ created_at: new Date(), last_used_at: new Date() }] : []
    }
    if (q.startsWith("SELECT COUNT(*)::int AS n FROM location_requests")) {
      return [{ n: requests.filter((r) => r.requester === v[0] && r.target === v[1]).length }]
    }
    if (q.startsWith("INSERT INTO location_requests")) {
      requests.push({ id: String(v[0]), requester: String(v[1]), target: String(v[2]), family: String(v[3]), status: q.includes("'PENDING'") ? "PENDING" : "?" })
      return []
    }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const call = async (userId: string, body: Record<string, unknown>) => {
    const headers = { "content-type": "application/json", authorization: `Bearer ${await generateAccessToken(userId)}` }
    const res = await route.POST(new Request("http://localhost/api/location/device-token/refresh", {
      method: "POST", headers, body: JSON.stringify(body),
    }) as unknown as Parameters<typeof route.POST>[0])
    return { status: res.status, json: await res.json() }
  }

  const other = await call("u-ray", { memberId: "m-kid", familyId: "fam-a" })
  assert.equal(other.status, 404)
  assert.equal(requests.length, 0)
  ok("someone else's member (your child's): refused, nothing saved")

  assert.equal((await call("u-ray", { memberId: "m-ray", familyId: "fam-b" })).status, 404)
  ok("wrong family: refused")

  assert.equal((await call("u-guest", { memberId: "m-guest", familyId: "fam-a" })).status, 403)
  ok("guest: refused")

  activeTokens.delete("u-ray|m-ray")
  const off = await call("u-ray", { memberId: "m-ray", familyId: "fam-a" })
  assert.equal(off.status, 409)
  assert.equal(off.json.code, "NO_BACKGROUND")
  assert.equal(requests.length, 0)
  ok("background sharing off: 409 NO_BACKGROUND, nothing saved (the page falls back)")
  activeTokens.add("u-ray|m-ray")

  const on = await call("u-ray", { memberId: "m-ray", familyId: "fam-a" })
  assert.equal(on.status, 200)
  assert.equal(requests.length, 1)
  assert.deepEqual({ ...requests[0], id: "-" }, { id: "-", requester: "u-ray", target: "u-ray", family: "fam-a", status: "PENDING" })
  ok("background on: one PENDING request to yourself, which the phone's poll answers")

  for (let i = 1; i < 10; i++) assert.equal((await call("u-ray", { memberId: "m-ray", familyId: "fam-a" })).status, 200)
  const capped = await call("u-ray", { memberId: "m-ray", familyId: "fam-a" })
  assert.equal(capped.status, 429)
  assert.equal(capped.json.code, "COOLDOWN")
  assert.equal(requests.length, 10)
  ok("11th in an hour: 429, still 10 saved")

  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
