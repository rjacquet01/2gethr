// Usage: npx tsx --tsconfig tsconfig.json scripts/test-family-invite.ts
// Parent and Guest invites sent by email, through the real
// /api/families/[familyId]/invite route on an in-memory fake database
// (lib/db __setSqlForTests) with Resend's API faked (global fetch). Nothing
// touches a real database or sends real email: DATABASE_URL points at a
// closed local port and the Resend key is a placeholder.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "family-invite-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "family-invite-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "family-invite-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake database rows
type Row = Record<string, any>

const FAMILY = "fam-1"
const PARENT = "u-parent"
const GUEST = "u-guest"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const route = await import("../app/api/families/[familyId]/invite/route")

  let db!: { invites: Row[]; audit: string[] }
  const fresh = () => { db = { invites: [], audit: [] } }
  const handlers: [string, (v: unknown[]) => Row[]][] = [
    ["FROM users WHERE id =", (v) => [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: String(v[0]).slice(2), last_name: "", is_active: true }]],
    ["SELECT id FROM families WHERE id", () => [{ id: FAMILY }]],
    // canManageInvites: the owner or a PARENT.
    ["SELECT 1 FROM families f", (v) => (v.includes(PARENT) ? [{ "?column?": 1 }] : [])],
    ["SELECT COUNT(*)::int AS n FROM family_invites", () => [{ n: db.invites.length }]],
    ["INSERT INTO family_invites", (v) => { db.invites.push({ id: v[0], code: v[2], role: v[3] }); return [{ id: v[0] }] }],
    ["SELECT name FROM families", () => [{ name: "Rivera" }]],
    ["AS name FROM family_members fm", () => [{ name: "Mom" }]],
    ["INSERT INTO audit_logs", (v) => { db.audit.push(JSON.stringify(v)); return [] }],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const sent: Row[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      sent.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
  process.env.RESEND_API_KEY = "re_test_placeholder_never_sent"

  const tokens: Record<string, string> = { [PARENT]: await generateAccessToken(PARENT), [GUEST]: await generateAccessToken(GUEST) }
  const invite = (userId: string, body: Row) =>
    route.POST(new NextRequest(`https://mytogethr.com/api/families/${FAMILY}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[userId]}` },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ familyId: FAMILY }) })
  const realError = console.error
  const quiet = async <T,>(fn: () => Promise<T>) => { console.error = () => {}; try { return await fn() } finally { console.error = realError } }

  for (const role of ["PARENT", "GUEST"] as const) {
    fresh()
    sent.length = 0
    const res = await quiet(() => invite(PARENT, { role, email: "jo@example.com" }))
    const body = await res.json()
    assert.equal(res.status, 200, JSON.stringify(body))
    assert.equal(body.data.role, role)
    assert.equal(body.data.emailed, true)
    assert.equal(body.data.joinLink, `https://mytogethr.com/onboarding?code=${body.data.code}`)
    assert.equal(db.invites[0].role, role, "the code is bound to the role")
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].to, ["jo@example.com"])
    assert.match(sent[0].subject, /Mom invited you to join the Rivera family on Togethr/)
    assert.ok(sent[0].html.includes(body.data.joinLink) && sent[0].text.includes(body.data.code))
    assert.match(sent[0].text, role === "PARENT" ? /as a parent[\s\S]*approves new parents/ : /as a guest/)
    assert.ok(!db.audit.some((a) => a.includes("jo@example.com")), "email address in the audit log")
    ok(`${role.toLowerCase()} invite: emailed with link + code, bound to ${role}, address not logged`)
  }

  fresh()
  sent.length = 0
  let res = await quiet(() => invite(PARENT, { role: "GUEST" }))
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.emailed, false)
  assert.equal(sent.length, 0)
  assert.ok(body.data.joinLink)
  ok("no email given: the link and code only, nothing sent")

  fresh()
  res = await quiet(() => invite(PARENT, { role: "CHILD", email: "kid@example.com" }))
  assert.equal(res.status, 400)
  assert.equal(db.invites.length, 0)
  ok("a plain CHILD code is refused (a child's invite goes with consent for a child profile)")

  fresh()
  res = await quiet(() => invite(PARENT, { role: "PARENT", email: "nope" }))
  assert.equal(res.status, 400)
  assert.equal(db.invites.length, 0)
  ok("a bad email address is refused before any code is made")

  fresh()
  res = await quiet(() => invite(GUEST, { role: "PARENT", email: "jo@example.com" }))
  assert.equal(res.status, 403)
  ok("not a parent or the owner: refused")

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
