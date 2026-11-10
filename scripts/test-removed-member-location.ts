// Usage: npx tsx --tsconfig tsconfig.json scripts/test-removed-member-location.ts
// Security review 2026-11-10 #26: a member removed from a family (row kept
// with is_active = false) can no longer be asked for their location, and
// requests between people who are no longer in the family together are not
// served to the phone or answered with a snapshot. Legal requests (requester
// "legal:<case>") are not family requests and still count.
// In-memory fake database (lib/db __setSqlForTests): no database, no network.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "removed-member-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "removed-member-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "removed-member-test-placeholder-not-used"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Member = { id: string; family_id: string; user_id: string; role: string; is_active: boolean }
type Req = { id: string; requester: string; target: string; family: string; status: string }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const route = await import("../app/api/location/request/route")
  const schema = await import("../lib/location-schema")

  const members: Member[] = [
    { id: "m-mom", family_id: "fam", user_id: "u-mom", role: "PARENT", is_active: true },
    { id: "m-kid", family_id: "fam", user_id: "u-kid", role: "CHILD", is_active: true },
    { id: "m-gone", family_id: "fam", user_id: "u-gone", role: "CHILD", is_active: false },
    { id: "m-exdad", family_id: "fam", user_id: "u-exdad", role: "PARENT", is_active: false },
  ]
  const requests: Req[] = []
  const active = (user: string, family: string) => members.some((m) => m.user_id === user && m.family_id === family && m.is_active)
  // Requests that pass the "both still active" rule, as the SQL states it.
  const bothActive = (r: Req) => active(r.target, r.family) && active(r.requester, r.family)

  __setSqlForTests((async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.includes("FROM users") && q.includes("WHERE id =")) return [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "T", is_active: true, role: "USER" }]
    if (q.startsWith("CREATE") || q.startsWith("ALTER") || q.startsWith("DO ")) return []
    if (q.includes("JOIN family_members target")) {
      const requireActive = q.includes("AND target.is_active = true")
      const me = members.find((m) => m.family_id === v[1] && m.user_id === v[2] && m.is_active)
      const t = members.find((m) => m.id === v[0] && m.family_id === v[1] && (!requireActive || m.is_active))
      return me && t ? [{ role: me.role, requester_user_id: me.user_id, target_member_id: t.id, target_user_id: t.user_id, target_role: t.role, target_name: null }] : []
    }
    if (q.startsWith("SELECT 1 FROM location_requests lr")) {
      assert.ok(q.includes("LIKE 'legal:%'") && q.includes("t.is_active = true") && q.includes("r.is_active = true"), "pending check must require both active (legal exempt)")
      return requests.filter((r) => r.target === v[0] && r.status === "PENDING" && (r.requester.startsWith("legal:") || bothActive(r))).slice(0, 1).map(() => ({ "?column?": 1 }))
    }
    if (q.startsWith("UPDATE location_requests SET status = 'FULFILLED', fulfilled_at = NOW(), snapshot_lat")) {
      assert.ok(q.includes("t.is_active = true") && q.includes("r.is_active = true"), "snapshot answers must require both active")
      const hit = requests.filter((r) => r.target === v[3] && r.status === "PENDING" && !r.requester.startsWith("legal:") && bothActive(r))
      hit.forEach((r) => { r.status = "FULFILLED" })
      return hit.map((r) => ({ id: r.id }))
    }
    if (q.startsWith("INSERT INTO location_requests")) {
      requests.push({ id: String(v[0]), requester: String(v[1]), target: String(v[2]), family: String(v[3]), status: q.includes("'PENDING'") ? "PENDING" : "AWAITING_APPROVAL" })
      return []
    }
    if (q.includes("FROM location_settings")) return []
    if (q.startsWith("SELECT created_at FROM location_requests")) return []
    if (q.includes("subscriptions") || q.includes("FROM families")) return [{ tier: "PREMIUM_PLUS", status: "ACTIVE", owner_id: "u-mom", name: "Fam" }]
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0])

  const ask = async (userId: string, memberId: string) => {
    const res = await route.POST(new NextRequest("http://localhost/api/location/request", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await generateAccessToken(userId)}` },
      body: JSON.stringify({ memberId, familyId: "fam" }),
    }))
    return res.status
  }

  assert.strictEqual(await ask("u-mom", "m-gone"), 404)
  assert.strictEqual(requests.length, 0)
  ok("asking a removed child for their location: refused, nothing saved")

  // Old requests made while both were members: the removed side stops counting.
  requests.push({ id: "r1", requester: "u-mom", target: "u-gone", family: "fam", status: "PENDING" })
  requests.push({ id: "r2", requester: "u-exdad", target: "u-kid", family: "fam", status: "PENDING" })
  assert.strictEqual(await schema.hasPendingLocationRequest("u-gone"), false)
  assert.strictEqual(await schema.hasPendingLocationRequest("u-kid"), false)
  assert.strictEqual(await schema.answerLocationRequests("u-kid", { latitude: 1, longitude: 2, accuracy: 5 }), 0)
  assert.strictEqual(requests.find((r) => r.id === "r2")!.status, "PENDING")
  ok("a removed member's open request isn't served to the phone and gets no snapshot")

  requests.push({ id: "r3", requester: "u-mom", target: "u-kid", family: "fam", status: "PENDING" })
  assert.strictEqual(await schema.hasPendingLocationRequest("u-kid"), true)
  assert.strictEqual(await schema.answerLocationRequests("u-kid", { latitude: 1, longitude: 2, accuracy: 5 }), 1)
  ok("current members: request served and answered as before")

  requests.push({ id: "r4", requester: "legal:case-1", target: "u-gone", family: "fam", status: "PENDING" })
  assert.strictEqual(await schema.hasPendingLocationRequest("u-gone"), true)
  ok("a legal request still counts for someone no longer in the family")

  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
