// Usage: npx tsx --tsconfig tsconfig.json scripts/test-child-invite.ts
// A parent invites a child of any age to their own account, optionally by
// email, through the real account-invite route on an in-memory fake database
// (lib/db __setSqlForTests) with Resend's API faked (global fetch). Nothing
// touches a real database or sends real email: DATABASE_URL points at a
// closed local port and the Resend key is a placeholder.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "child-invite-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "child-invite-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "child-invite-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake database rows
type Row = Record<string, any>

const FAMILY = "fam-1"
const PARENT = "u-parent"
const ADULT = "u-adult"
const KID = "m-kid"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const { findChildAccountInvite } = await import("../lib/family-invites")
  const route = await import("../app/api/families/[familyId]/children/[memberId]/account-invite/route")

  let db!: { child: Row; invites: Row[]; audit: string[] }
  const fresh = (child: Partial<Row> = {}) => {
    db = { child: { id: KID, user_id: null, role: "CHILD", display_name: "Sam", age: null, dob: null, ...child }, invites: [], audit: [] }
  }
  const handlers: [string, (v: unknown[]) => Row[]][] = [
    ["FROM users WHERE id =", (v) => [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: String(v[0]).slice(2), last_name: "", is_active: true }]],
    // canManageFamily: a PARENT member (or the owner) of the family.
    ["SELECT 1 FROM families f", (v) => (v.includes(PARENT) ? [{ "?column?": 1 }] : [])],
    ["JOIN child_profiles cp ON cp.family_member_id = fm.id WHERE fm.id =", (v) => (v[0] === KID ? [db.child] : [])],
    ["INSERT INTO family_invites", (v) => {
      db.invites.push({ id: v[0], family_id: v[1], code: v[2], expires_at: v[4], child_member_id: v[5], consent_by: v[6] })
      return [{ id: v[0] }]
    }],
    ["SELECT name FROM families", () => [{ name: "Rivera" }]],
    ["AS name FROM family_members fm", () => [{ name: "Mom" }]],
    ["INSERT INTO audit_logs", (v) => { db.audit.push(JSON.stringify(v)); return [] }],
    // findChildAccountInvite: the code the parent made, joined to the child.
    ["FROM family_invites i JOIN families f", (v) => {
      const inv = db.invites.find((i) => i.code === v[0])
      return inv ? [{
        id: inv.id, family_id: FAMILY, role: "CHILD", expires_at: inv.expires_at, used_at: null, revoked_at: null,
        child_member_id: KID, consent_by: inv.consent_by, family_name: "Rivera",
        child_user_id: db.child.user_id, child_role: "CHILD", child_active: true, display_name: db.child.display_name, age: db.child.age, dob: db.child.dob,
      }] : []
    }],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  // Resend's API, faked.
  const sent: Row[] = []
  let resendFails = false
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      if (resendFails) return new Response(JSON.stringify({ message: "nope" }), { status: 500 })
      sent.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch

  const tokens: Record<string, string> = { [PARENT]: await generateAccessToken(PARENT), [ADULT]: await generateAccessToken(ADULT) }
  const invite = (userId: string, body: Row) =>
    route.POST(new NextRequest(`https://mytogethr.com/api/families/${FAMILY}/children/${KID}/account-invite`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[userId]}` },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ familyId: FAMILY, memberId: KID }) })
  const realWarn = console.warn
  const realError = console.error
  const quiet = async <T,>(fn: () => Promise<T>) => { console.warn = () => {}; console.error = () => {}; try { return await fn() } finally { console.warn = realWarn; console.error = realError } }

  console.log("no age gate")
  for (const [label, child] of [["no birthdate", {}], ["age 5", { dob: "2021-01-15" }], ["age 15", { dob: "2011-03-03" }]] as const) {
    fresh(child)
    delete process.env.RESEND_API_KEY
    const res = await quiet(() => invite(PARENT, { consent: true }))
    const body = await res.json()
    assert.equal(res.status, 200, `${label}: ${JSON.stringify(body)}`)
    assert.match(body.data.code, /^[A-Z0-9]{8}$/)
    assert.equal(body.data.joinLink, `https://mytogethr.com/onboarding?code=${body.data.code}`)
    const found = await findChildAccountInvite(body.data.code)
    assert.equal(found.ok, true, `${label}: the code works at sign-up`)
    ok(`${label}: a parent can invite, and the code is accepted at sign-up`)
  }

  console.log("email")
  fresh()
  process.env.RESEND_API_KEY = "re_test_placeholder_never_sent"
  let res = await quiet(() => invite(PARENT, { consent: true, email: "sam.kid@example.com" }))
  let body = await res.json()
  assert.equal(body.data.emailed, true)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].to, ["sam.kid@example.com"])
  assert.match(sent[0].subject, /Mom set up a Togethr account for you/)
  assert.ok(sent[0].html.includes(body.data.joinLink) && sent[0].text.includes(body.data.code))
  assert.match(sent[0].html, /Hi Sam,/)
  ok("the invite is emailed to the child with the link and the code")
  assert.ok(!db.audit.some((a) => a.includes("sam.kid@example.com")), "email address in the audit log")
  assert.ok(db.audit.some((a) => a.includes('\\"emailed\\":true')))
  ok("the audit log records that it was emailed, never the address")

  fresh()
  resendFails = true
  res = await quiet(() => invite(PARENT, { consent: true, email: "sam.kid@example.com" }))
  body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.emailed, false)
  assert.match(body.data.emailError, /could not be sent/)
  assert.ok(body.data.code && body.data.joinLink)
  resendFails = false
  ok("if the email fails, the parent still gets the link and code to share")

  fresh()
  delete process.env.RESEND_API_KEY
  res = await quiet(() => invite(PARENT, { consent: true, email: "sam.kid@example.com" }))
  body = await res.json()
  assert.equal(body.data.emailed, false)
  assert.match(body.data.emailError, /isn't set up/)
  ok("without email configured: the link and code, and a clear message")

  fresh()
  res = await quiet(() => invite(PARENT, { consent: true, email: "not-an-email" }))
  assert.equal(res.status, 400)
  assert.equal(db.invites.length, 0)
  ok("a bad email address is refused before any code is made")

  console.log("still guarded")
  fresh()
  res = await quiet(() => invite(PARENT, { email: "sam.kid@example.com" }))
  assert.equal(res.status, 400)
  assert.equal(db.invites.length, 0)
  ok("no consent box ticked: refused")
  fresh()
  res = await quiet(() => invite(ADULT, { consent: true }))
  assert.equal(res.status, 403)
  ok("not a parent: refused")
  fresh({ user_id: "u-sam" })
  res = await quiet(() => invite(PARENT, { consent: true }))
  assert.equal(res.status, 400)
  ok("a child who already has an account: refused")

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
