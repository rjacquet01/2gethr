// Usage: npx tsx --tsconfig tsconfig.json scripts/test-legal-hold-closure.ts
// An account under a legal hold (open case or preservation request) can't be
// deleted: self-service deletion, admin closure, a parent withdrawing a
// child's consent and removing a child are refused before anything changes,
// and a family whose deletion would close a held child's login is refused.
// In-memory fake database (lib/db __setSqlForTests): DATABASE_URL points at a
// closed local port, nothing real is touched.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "legal-hold-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "legal-hold-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "legal-hold-test-admin-secret-not-real-0123456789"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const FAMILY = "fam-1"
const HELD = "u-held"
const FREE = "u-free"
const ADMIN = "admin-1"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken, generateAdminAccessToken } = await import("../lib/auth").then(async (a) => ({
    ...a, ...(await import("../lib/admin-auth")),
  }))
  const { NextRequest } = await import("next/server")
  const closure = await import("../lib/account-closure")
  const consent = await import("../lib/parental-consent")
  const deleteRoute = await import("../app/api/account/delete/route")
  const adminUserRoute = await import("../app/api/admin/users/[userId]/route")

  let held = new Set<string>([HELD])
  let legalCheckFails = false
  let writes: string[] = []
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    // The legal module seeds its admin roles once (ON CONFLICT DO NOTHING): setup, not a change.
    const seed = /^INSERT INTO admin_(roles|permissions|role_permissions) /.test(q)
    if (/^(INSERT|UPDATE|DELETE)/.test(q) && !seed) writes.push(q)
    if (q.includes("FROM legal_cases c")) {
      if (legalCheckFails) throw new Error("database unavailable")
      return held.has(v[0] as string) ? [{ "?column?": 1 }] : []
    }
    if (q.startsWith("WITH u AS")) {
      return [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "A", last_name: "", is_active: true,
        member_id: `m-${v[0]}`, role: "PARENT", family_id: FAMILY, family_name: "Testers", owner_id: v[0] }]
    }
    // children: one child login, in no other family
    if (q.startsWith("SELECT fm.id, fm.user_id, fm.role, u.email")) return [{ id: "m-kid", user_id: HELD, role: "CHILD", email: null }]
    if (q.startsWith("SELECT user_id FROM family_members WHERE id =")) return [{ user_id: HELD }]
    if (q.startsWith("SELECT 1 FROM family_members WHERE user_id")) return []
    if (q.startsWith("SELECT fm.user_id FROM family_members fm")) return [{ user_id: HELD }]
    // admin auth
    if (q.includes("FROM admin_users")) return v[0] === ADMIN ? [{ id: ADMIN, email: "admin@example.invalid", status: "ACTIVE", mfa_enabled: true }] : []
    if (q.includes("FROM admin_roles r")) return [{ name: "SUPER_ADMIN" }]
    if (q.includes("SELECT DISTINCT p.key")) return []
    if (q.startsWith("SELECT id, email FROM users WHERE id")) return [{ id: v[0], email: `${v[0]}@example.invalid` }]
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)
  const reset = () => { held = new Set([HELD]); legalCheckFails = false; writes = [] }

  // 1. The closure itself: refused before any write; goes ahead without a hold.
  reset()
  await assert.rejects(closure.closeUserAccount({ id: HELD, email: "held@example.invalid" }), closure.LegalHoldError)
  assert.deepStrictEqual(writes, [], "nothing changed for a held account")
  reset()
  await closure.closeUserAccount({ id: FREE, email: "free@example.invalid" })
  assert.ok((writes as string[]).some((w) => w.startsWith("DELETE FROM location_pings")), "a normal closure still deletes")
  ok("closeUserAccount: LegalHoldError and no writes under a hold; normal closure unchanged")

  // 2. If the hold check itself fails, the data is kept (fail closed).
  reset()
  legalCheckFails = true
  await assert.rejects(closure.closeUserAccount({ id: FREE, email: "free@example.invalid" }), closure.LegalHoldError)
  assert.deepStrictEqual(writes, [])
  ok("hold check unavailable: closure refused, nothing changed")

  // 3. Self-service deletion: 409 with a message that doesn't mention the hold.
  reset()
  const token = await generateAccessToken(HELD)
  const res = await deleteRoute.POST(new Request("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirmEmail: `${HELD}@example.invalid` }),
  }))
  assert.strictEqual(res.status, 409)
  const body = await res.json()
  assert.strictEqual(body.error, closure.ACCOUNT_CLOSURE_BLOCKED_MESSAGE)
  assert.ok(!/legal|hold|law/i.test(body.error), "the person isn't told why")
  assert.deepStrictEqual(writes, [])
  ok("self-service deletion under a hold: 409, neutral message, nothing changed")

  // 4. Admin closure: 409 with the reason, and no audit entry claiming a closure.
  reset()
  const adminToken = await generateAdminAccessToken({ id: ADMIN, email: "admin@example.invalid", firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: true, roles: ["SUPER_ADMIN"], permissions: [] } as Parameters<typeof generateAdminAccessToken>[0])
  const adminRes = await adminUserRoute.PATCH(
    new NextRequest(`http://localhost/api/admin/users/${HELD}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: "close", reason: "test" }),
    }),
    { params: Promise.resolve({ userId: HELD }) }
  )
  assert.strictEqual(adminRes.status, 409)
  assert.strictEqual((await adminRes.json()).error, closure.ACCOUNT_CLOSURE_BLOCKED_ADMIN_MESSAGE)
  assert.deepStrictEqual(writes, [], "no audit row and no change")
  ok("admin closure under a hold: 409 with the reason, nothing written")

  // 5. A parent withdrawing consent for a held child, or removing the child: refused first.
  reset()
  await assert.rejects(consent.withdrawChildConsent({ familyId: FAMILY, childMemberId: "m-kid", withdrawnBy: FREE }), closure.LegalHoldError)
  assert.deepStrictEqual(writes, [], "consent not marked withdrawn, nothing deleted")
  reset()
  await assert.rejects(consent.deleteChildData({ familyId: FAMILY, childMemberId: "m-kid", closeAccount: "if-no-other-family" }), closure.LegalHoldError)
  assert.deepStrictEqual(writes, [], "invite codes untouched, member kept")
  ok("child consent withdrawal / removal under a hold: refused before any change")

  // 6. Deleting a family that would close a held child's login is refused up front.
  reset()
  assert.strictEqual(await consent.familyChildAccountUnderHold(FAMILY), true)
  held = new Set()
  assert.strictEqual(await consent.familyChildAccountUnderHold(FAMILY), false)
  ok("family deletion: a held child login blocks it before anything changes")

  __setSqlForTests(null)
  console.log(`\n${passed} checks passed`)
}

main().then(() => process.exit(0), (err) => {
  console.error(err)
  process.exit(1)
})
