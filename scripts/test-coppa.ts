// Usage: npx tsx --tsconfig tsconfig.json scripts/test-coppa.ts
// The age rule and parental consent, through the real routes. Every query
// goes to an in-memory fake (lib/db __setSqlForTests): nothing touches a real
// database, and DATABASE_URL points at a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "coppa-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "coppa-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "coppa-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
delete process.env.RESEND_API_KEY // admin signup emails are skipped, never sent

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>
interface Query { q: string; v: unknown[] }

const PARENT = "11111111-1111-4111-8111-111111111111"
const FAMILY = "22222222-2222-4222-8222-222222222222"
const CHILD_MEMBER = "33333333-3333-4333-8333-333333333333"
const IP = "203.0.113.7"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const { CHILD_CONSENT_TEXT, CHILD_CONSENT_VERSION, TERMS_VERSION } = await import("../lib/consent-text")
  const register = await import("../app/api/auth/register/route")
  const join = await import("../app/api/families/join/route")
  const invite = await import("../app/api/families/[familyId]/invite/route")
  const children = await import("../app/api/families/[familyId]/children/route")
  const consent = await import("../app/api/families/[familyId]/children/[memberId]/consent/route")

  // ---- fake database ----------------------------------------------------------------------
  const log: Query[] = []
  // Per-test answers: the first matcher whose text is found in the query wins.
  let answers: [string, (v: unknown[]) => Row[]][] = []
  const base: [string, (v: unknown[]) => Row[]][] = [
    ["FROM users WHERE id =", (v) => (v[0] === PARENT ? [{ id: PARENT, email: "parent@example.invalid", first_name: "Pat", last_name: "Parent", is_active: true }] : [])],
    ["SELECT id FROM users WHERE email", () => []],
    ["SELECT 1 FROM families f", () => [{ "?column?": 1 }]],
    ["SELECT id FROM families WHERE id", () => [{ id: FAMILY }]],
    ["SELECT tier, status, trial_ends_at", () => []],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    log.push({ q, v })
    for (const [needle, fn] of [...answers, ...base]) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const writes = (needle: string) => log.filter((x) => /^(INSERT|UPDATE|DELETE)/.test(x.q) && x.q.includes(needle))
  const reset = (a: typeof answers = []) => { log.length = 0; answers = a }

  const token = await generateAccessToken(PARENT)
  const req = (method: string, path: string, body?: unknown, auth = true) =>
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `${IP}, 10.0.0.1`,
        "user-agent": "coppa-test",
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const realError = console.error
  const quiet = async <T,>(fn: () => Promise<T>) => { console.error = () => {}; try { return await fn() } finally { console.error = realError } }

  const adult = { email: "new.adult@example.invalid", password: "Passw0rdOK", displayName: "Alex Adult" }

  // 1. Sign-up: 18+ confirmation and Terms/Privacy acceptance are server-enforced.
  console.log("sign-up")
  {
    reset()
    let r: Response = await register.POST(req("POST", "/api/auth/register", { ...adult, termsAccepted: true }, false))
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /18 or older/)
    r = await register.POST(req("POST", "/api/auth/register", { ...adult, ageConfirmed: false, termsAccepted: true }, false))
    assert.strictEqual(r.status, 400)
    r = await register.POST(req("POST", "/api/auth/register", { ...adult, ageConfirmed: "yes", termsAccepted: true }, false))
    assert.strictEqual(r.status, 400, "only boolean true counts")
    assert.strictEqual(log.length, 0, "rejected before any database work")
    ok("sign-up without the 18+ confirmation is 400 (missing, false or not a boolean), nothing written")

    r = await register.POST(req("POST", "/api/auth/register", { ...adult, ageConfirmed: true }, false))
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /Terms of Service and Privacy Policy/)
    ok("sign-up without Terms/Privacy acceptance is 400")

    reset()
    r = await quiet(() => register.POST(req("POST", "/api/auth/register", { ...adult, ageConfirmed: true, termsAccepted: true }, false)))
    assert.strictEqual(r.status, 200)
    const userInsert = writes("INSERT INTO users")[0]
    assert.ok(userInsert, "user created")
    assert.ok(userInsert.q.includes("age_confirmed_at, terms_accepted_at, terms_version"))
    const [ageAt, termsAt, version] = userInsert.v.slice(-3)
    assert.ok(ageAt && termsAt, "age confirmation and terms acceptance timestamps stored")
    assert.strictEqual(version, TERMS_VERSION)
    const consentRows = writes("INSERT INTO consents")
    assert.deepStrictEqual(consentRows.map((c) => c.v[2]), ["TERMS_OF_SERVICE", "PRIVACY_POLICY"])
    assert.ok(consentRows.every((c) => c.v[3] === IP && c.v[5] === TERMS_VERSION), "IP and version recorded")
    ok("adult sign-up stores age confirmation, terms version and Terms/Privacy consent rows with IP")
  }

  // 2. A join code can never create a minor.
  console.log("join codes")
  {
    const inviteRow = (extra: Row) => [["FROM family_invites i JOIN families f ON f.id = i.family_id WHERE i.code", () => [{
      id: "inv_1", family_id: FAMILY, role: "CHILD", expires_at: new Date(Date.now() + 86400000).toISOString(),
      used_at: null, revoked_at: null, child_member_id: null, family_name: "Test Family", ...extra,
    }]], ["SELECT 1 FROM family_members WHERE family_id", () => [{ "?column?": 1 }]]] as typeof answers
    reset(inviteRow({}))
    let r: Response = await join.POST(req("POST", "/api/families/join", { inviteCode: "ABCD2345" }))
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /Add child/)
    assert.deepStrictEqual(writes("family_members"), [], "no membership created")
    assert.deepStrictEqual(writes("child_profiles"), [], "no child profile created")
    assert.deepStrictEqual(writes("family_invites"), [], "code not used up")
    ok("an old generic CHILD join code is refused: no member, no child profile, code untouched")

    reset(inviteRow({ child_member_id: CHILD_MEMBER }))
    r = await join.POST(req("POST", "/api/families/join", { inviteCode: "ABCD2345" }))
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /Create account/)
    assert.deepStrictEqual(writes("family_members"), [])
    ok("a child-account code can't attach an existing (adult) account to a child")

    reset()
    r = (await invite.POST(req("POST", `/api/families/${FAMILY}/invite`, { role: "CHILD" }), { params: Promise.resolve({ familyId: FAMILY }) })) as Response
    assert.strictEqual(r.status, 400)
    assert.deepStrictEqual(writes("INSERT INTO family_invites"), [])
    ok("parents can no longer create CHILD join codes")

    // Registering with a code that isn't a parent-made child-account code.
    reset([["fm.user_id AS child_user_id", () => [{
      id: "inv_2", family_id: FAMILY, role: "CHILD", expires_at: new Date(Date.now() + 86400000).toISOString(),
      used_at: null, revoked_at: null, child_member_id: null, consent_by: null, family_name: "Test Family",
    }]]])
    r = await register.POST(req("POST", "/api/auth/register", { ...adult, email: "kid@example.invalid", childInviteCode: "ABCD2345" }, false))
    assert.strictEqual(r.status, 400)
    assert.deepStrictEqual(writes("INSERT INTO users"), [], "no account created")
    ok("signing up with a plain join code skips nothing: no under-18 account without parent consent")
  }

  // 3. A parent-made child account code (consent given) creates the child's login.
  console.log("child account sign-up")
  {
    reset([
      ["fm.user_id AS child_user_id", () => [{
        id: "inv_3", family_id: FAMILY, role: "CHILD", expires_at: new Date(Date.now() + 86400000).toISOString(),
        used_at: null, revoked_at: null, child_member_id: CHILD_MEMBER, consent_by: PARENT, family_name: "Test Family",
        child_user_id: null, child_role: "CHILD", child_active: true, display_name: "Sam", age: 10, dob: null,
      }]],
      ["UPDATE family_invites SET used_at = NOW()", () => [{ id: "inv_3" }]],
      ["UPDATE family_members SET user_id", () => [{ id: CHILD_MEMBER }]],
      ["UPDATE location_settings SET mode = 'OFF'", () => [{ id: "ls_1" }]],
    ])
    const r = await quiet(() => register.POST(req("POST", "/api/auth/register", { email: "sam@example.invalid", password: "Passw0rdOK", displayName: "Sam", childInviteCode: "ABCD2345" }, false)))
    assert.strictEqual(r.status, 200)
    const body = await r.json()
    assert.deepStrictEqual(body.data.linkedFamily, { familyId: FAMILY, familyName: "Test Family" })
    const u = writes("INSERT INTO users")[0]
    assert.deepStrictEqual(u.v.slice(-3), [null, null, null], "no adult confirmation stored for a child")
    assert.strictEqual(u.v[5], null, "no phone for a child")
    assert.deepStrictEqual(writes("INSERT INTO consents"), [], "a child doesn't accept terms themselves")
    assert.ok(writes("UPDATE location_settings SET mode = 'OFF'").length === 1, "location stays off")
    assert.ok(writes("UPDATE parental_consents SET child_user_id").length === 1, "parent's consent tied to the new login")
    ok("child sign-up with the parent's code: linked, no 18+ claim, no phone, location off, consent linked")
  }

  // 4. Child creation needs the parent's consent; the record is stored.
  console.log("child creation")
  {
    const parentMember: typeof answers = [["SELECT role FROM family_members", () => [{ role: "PARENT" }]], ["SELECT COUNT(*) as count FROM family_members", () => [{ count: 0 }]]]
    const ctx = { params: Promise.resolve({ familyId: FAMILY }) }
    reset(parentMember)
    let r: Response = await children.POST(req("POST", `/api/families/${FAMILY}/children`, { displayName: "Robin", dateOfBirth: "2018-05-01" }), ctx)
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /consent/)
    r = await children.POST(req("POST", `/api/families/${FAMILY}/children`, { displayName: "Robin", consent: false }), { params: Promise.resolve({ familyId: FAMILY }) })
    assert.strictEqual(r.status, 400)
    assert.deepStrictEqual(writes("INSERT"), [], "nothing created")
    ok("adding a child without the consent box (missing or false) is 400 and creates nothing")

    reset(parentMember)
    r = await quiet(() => children.POST(req("POST", `/api/families/${FAMILY}/children`, { displayName: "Robin", dateOfBirth: "2018-05-01", consent: true }), { params: Promise.resolve({ familyId: FAMILY }) }))
    assert.strictEqual(r.status, 200)
    const childMemberId = (await r.json()).data.memberId
    const pc = writes("INSERT INTO parental_consents")
    assert.strictEqual(pc.length, 1, "one consent row")
    const [, family, parent, childMember, childUser, scope, ver, text, ip, ua] = pc[0].v
    assert.deepStrictEqual([family, parent, childMember, childUser, scope], [FAMILY, PARENT, childMemberId, null, "CHILD_PROFILE"])
    assert.strictEqual(ver, CHILD_CONSENT_VERSION)
    assert.strictEqual(text, CHILD_CONSENT_TEXT, "the exact text the parent saw")
    assert.strictEqual(ip, IP)
    assert.strictEqual(ua, "coppa-test")
    const ls = writes("INSERT INTO location_settings")[0]
    assert.ok(ls && ls.q.includes("'OFF', false"), "location off by default")
    ok("with consent: child created, consent row has parent, child, timestamp, text version, exact text and IP")
  }

  // 5. Withdrawing consent deletes the child's data and keeps the record.
  console.log("withdraw consent")
  {
    const ctx = () => ({ params: Promise.resolve({ familyId: FAMILY, memberId: CHILD_MEMBER }) })
    const childRow: typeof answers = [
      ["SELECT fm.id, cp.display_name FROM family_members fm", () => [{ id: CHILD_MEMBER, display_name: "Robin" }]],
      ["SELECT fm.id, fm.user_id, fm.role, u.email", () => [{ id: CHILD_MEMBER, user_id: null, role: "CHILD", email: null }]],
    ]
    reset(childRow)
    let r: Response = await consent.DELETE(req("DELETE", `/api/families/${FAMILY}/children/${CHILD_MEMBER}/consent`, {}), ctx())
    assert.strictEqual(r.status, 400)
    assert.deepStrictEqual(writes("DELETE FROM family_members"), [])
    ok("withdrawal needs an explicit confirm")

    reset(childRow)
    r = await quiet(() => consent.DELETE(req("DELETE", `/api/families/${FAMILY}/children/${CHILD_MEMBER}/consent`, { confirm: true }), ctx()))
    assert.strictEqual(r.status, 200)
    assert.strictEqual(writes("UPDATE parental_consents SET withdrawn_at").length, 1, "record marked withdrawn, not deleted")
    assert.deepStrictEqual(writes("DELETE FROM parental_consents"), [])
    const del = writes("DELETE FROM family_members")
    assert.strictEqual(del.length, 1)
    assert.strictEqual(del[0].v[0], CHILD_MEMBER, "the child's membership (and so profile, location settings) deleted")
    assert.strictEqual(writes("UPDATE family_invites SET revoked_at").length, 1, "unused account codes cancelled")
    ok("withdrawing consent deletes the child's data and keeps the consent record, marked withdrawn")
  }

  __setSqlForTests(null)
  console.log(`\nAll ${passed} COPPA checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
