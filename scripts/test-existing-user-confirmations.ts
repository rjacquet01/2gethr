// Usage: npx tsx --tsconfig tsconfig.json scripts/test-existing-user-confirmations.ts
// One-time confirmations for people from before the age rule and parental
// consent, through the real routes, on a small stateful in-memory database
// (lib/db __setSqlForTests). Nothing touches a real database: DATABASE_URL
// points at a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "existing-users-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "existing-users-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "existing-users-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>

const FAMILY = "fam-1"
const OLD_ADULT = "u-old-adult"   // signed up before the age rule: nothing confirmed
const PARENT = "u-parent"         // already confirmed
const TEEN = "u-teen"             // a child's own login (created from a parent's code)
const STRANGER = "u-stranger"     // confirmed adult in no family
const NO_CONSENT = "m-ava"        // child profile, no login, no consent record
const NO_CONSENT_LOGIN = "m-teen" // child with a login, no consent record
const HAS_CONSENT = "m-ben"       // child profile with a consent record
const IP = "203.0.113.9"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const { CHILD_CONSENT_TEXT, CHILD_CONSENT_VERSION, TERMS_VERSION } = await import("../lib/consent-text")
  const { NO_PRIOR_CONSENT_NOTE } = await import("../lib/parental-consent")
  const me = await import("../app/api/auth/me/route")
  const confirmRoute = await import("../app/api/auth/confirm-age-terms/route")
  const pending = await import("../app/api/families/pending-consents/route")
  const consent = await import("../app/api/families/[familyId]/children/[memberId]/consent/route")

  // ---- stateful fake database ------------------------------------------------------------------
  let db!: { users: Row[]; families: Row[]; members: Row[]; profiles: Row[]; consents: Row[]; parentalConsents: Row[]; writes: string[] }
  const fresh = () => {
    const user = (id: string, confirmed: boolean) => ({
      id, email: `${id}@example.invalid`, first_name: id.slice(2), last_name: "", is_active: true,
      age_confirmed_at: confirmed ? new Date("2026-10-19") : null,
      terms_accepted_at: confirmed ? new Date("2026-10-19") : null,
      terms_version: confirmed ? TERMS_VERSION : null,
    })
    db = {
      users: [user(OLD_ADULT, false), user(PARENT, true), user(TEEN, false), user(STRANGER, true)],
      families: [{ id: FAMILY, name: "The Testers", owner_id: PARENT }],
      members: [
        { id: "m-parent", family_id: FAMILY, user_id: PARENT, role: "PARENT", is_active: true },
        { id: "m-old", family_id: FAMILY, user_id: OLD_ADULT, role: "ADULT", is_active: true },
        { id: NO_CONSENT, family_id: FAMILY, user_id: null, role: "CHILD", is_active: true },
        { id: NO_CONSENT_LOGIN, family_id: FAMILY, user_id: TEEN, role: "CHILD", is_active: true },
        { id: HAS_CONSENT, family_id: FAMILY, user_id: null, role: "CHILD", is_active: true },
      ],
      profiles: [
        { family_member_id: NO_CONSENT, display_name: "Ava" },
        { family_member_id: NO_CONSENT_LOGIN, display_name: "Tess" },
        { family_member_id: HAS_CONSENT, display_name: "Ben" },
      ],
      consents: [],
      parentalConsents: [
        { id: "pc-ben", family_id: FAMILY, parent_user_id: PARENT, child_member_id: HAS_CONSENT, withdrawn_at: null },
      ],
      writes: [],
    }
  }
  fresh()
  const manages = (familyId: unknown, userId: unknown) =>
    db.families.some((f) => f.id === familyId && f.owner_id === userId) ||
    db.members.some((m) => m.family_id === familyId && m.user_id === userId && m.is_active && m.role === "PARENT")
  const hasRecord = (memberId: unknown, familyId: unknown) =>
    db.parentalConsents.some((c) => c.child_member_id === memberId && c.family_id === familyId)

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) db.writes.push(q)
    if (q.startsWith("SELECT age_confirmed_at, terms_accepted_at FROM users")) return db.users.filter((u) => u.id === v[0])
    if (q.includes("FROM users WHERE id =")) return db.users.filter((u) => u.id === v[0])
    if (q.startsWith("SELECT 1 FROM family_members WHERE user_id = ? AND role = 'CHILD'")) return db.members.filter((m) => m.user_id === v[0] && m.role === "CHILD").slice(0, 1)
    if (q.startsWith("SELECT 1 FROM families f")) return manages(v[0], v[1]) ? [{ "?column?": 1 }] : []
    if (q.startsWith("SELECT fm.id, fm.family_id, fm.user_id, f.name AS family_name")) {
      return db.members
        .filter((m) => m.role === "CHILD" && manages(m.family_id, v[0]) && !hasRecord(m.id, m.family_id))
        .map((m) => ({
          id: m.id, family_id: m.family_id, user_id: m.user_id,
          family_name: db.families.find((f) => f.id === m.family_id)?.name,
          display_name: db.profiles.find((p) => p.family_member_id === m.id)?.display_name ?? null,
          first_name: null,
        }))
    }
    if (q.startsWith("SELECT fm.id, fm.user_id, cp.display_name")) {
      const m = db.members.find((x) => x.id === v[0] && x.family_id === v[1] && x.role === "CHILD")
      return m ? [{ id: m.id, user_id: m.user_id, display_name: db.profiles.find((p) => p.family_member_id === m.id)?.display_name ?? null }] : []
    }
    if (q.startsWith("SELECT 1 FROM parental_consents WHERE child_member_id")) return hasRecord(v[0], v[1]) ? [{ "?column?": 1 }] : []
    if (q.startsWith("SELECT user_id FROM family_members WHERE id")) return db.members.filter((m) => m.id === v[0] && m.family_id === v[1] && m.role === "CHILD")
    if (q.startsWith("SELECT fm.id, fm.user_id, fm.role, u.email")) {
      const m = db.members.find((x) => x.id === v[0] && x.family_id === v[1] && x.role === "CHILD")
      return m ? [{ ...m, email: null }] : []
    }
    if (q.startsWith("UPDATE users SET age_confirmed_at")) {
      const u = db.users.find((x) => x.id === v[1])
      if (u) Object.assign(u, { age_confirmed_at: u.age_confirmed_at ?? new Date(), terms_accepted_at: new Date(), terms_version: v[0] })
      return []
    }
    if (q.startsWith("INSERT INTO consents")) {
      db.consents.push({ id: v[0], user_id: v[1], type: v[2], ip_address: v[3], user_agent: v[4], version: v[5] })
      return []
    }
    if (q.startsWith("INSERT INTO parental_consents")) {
      const withdrawn = q.includes("withdrawn_at")
      db.parentalConsents.push({
        id: v[0], family_id: v[1], parent_user_id: v[2], child_member_id: v[3], child_user_id: v[4], scope: v[5],
        consent_text_version: v[6], consent_text: v[7], ip_address: v[8], user_agent: v[9],
        granted_at: new Date(), withdrawn_at: withdrawn ? new Date() : null, withdrawn_by: withdrawn ? v[10] : null,
      })
      return []
    }
    if (q.startsWith("UPDATE parental_consents SET withdrawn_at")) {
      for (const c of db.parentalConsents) if (c.child_member_id === v[1] && c.family_id === v[2] && !c.withdrawn_at) { c.withdrawn_at = new Date(); c.withdrawn_by = v[0] }
      return []
    }
    if (q.startsWith("DELETE FROM family_members")) {
      const gone = db.members.filter((m) => m.id === v[0] && m.family_id === v[1] && m.role === "CHILD").map((m) => m.id)
      db.members = db.members.filter((m) => !gone.includes(m.id))
      db.profiles = db.profiles.filter((p) => !gone.includes(p.family_member_id)) // ON DELETE CASCADE
      return []
    }
    if (q.startsWith("DELETE FROM parental_consents")) throw new Error("consent rows must never be deleted")
    return [] // schema ensures, memberships for /me, audit logs, invite revocation
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const tokens: Record<string, string> = {}
  for (const id of [OLD_ADULT, PARENT, TEEN, STRANGER]) tokens[id] = await generateAccessToken(id)
  const req = (as: string, method: string, path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `${IP}, 10.0.0.1`,
        "user-agent": "existing-users-test",
        authorization: `Bearer ${tokens[as]}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const meFlag = async (as: string) => {
    const r = await me.GET(req(as, "GET", "/api/auth/me"))
    assert.strictEqual(r.status, 200)
    return (await r.json()).user.needsAgeTermsConfirmation as boolean
  }
  const confirmAs = (as: string, body: unknown) => confirmRoute.POST(req(as, "POST", "/api/auth/confirm-age-terms", body))
  const pendingFor = async (as: string) => {
    const r = await pending.GET(req(as, "GET", "/api/families/pending-consents"))
    assert.strictEqual(r.status, 200)
    return (await r.json()).data.children as { memberId: string; name: string; hasLogin: boolean }[]
  }
  const consentCall = (as: string, method: "POST" | "DELETE", memberId: string, body: unknown) =>
    (method === "POST" ? consent.POST : consent.DELETE)(req(as, method, `/api/families/${FAMILY}/children/${memberId}/consent`, body), {
      params: Promise.resolve({ familyId: FAMILY, memberId }),
    })

  // ---- Task A: 18+ and Terms for adults from before the change ----------------------------------
  console.log("existing adults: 18+ and Terms")
  {
    fresh()
    assert.strictEqual(await meFlag(OLD_ADULT), true)
    assert.strictEqual(await meFlag(PARENT), false)
    ok("a pre-existing adult is asked (on login and app load, via /api/auth/me); a confirmed adult isn't")

    assert.strictEqual(await meFlag(TEEN), false)
    let r = await confirmAs(TEEN, { ageConfirmed: true, termsAccepted: true })
    assert.strictEqual(r.status, 403)
    assert.strictEqual(db.users.find((u) => u.id === TEEN)!.age_confirmed_at, null)
    assert.deepStrictEqual(db.writes, [], "nothing written for a child")
    ok("a child account is never asked, and the server refuses a confirmation from one")

    r = await pending.GET(req(OLD_ADULT, "GET", "/api/families/pending-consents"))
    assert.strictEqual(r.status, 200, "other API routes keep working before confirming")
    ok("an unconfirmed adult is not locked out of the API")

    for (const bad of [{}, { ageConfirmed: true }, { termsAccepted: true }, { ageConfirmed: "yes", termsAccepted: true }, { ageConfirmed: true, termsAccepted: false }]) {
      r = await confirmAs(OLD_ADULT, bad)
      assert.strictEqual(r.status, 400, JSON.stringify(bad))
    }
    assert.deepStrictEqual(db.writes, [])
    ok("both confirmations must be exactly true (400 otherwise, nothing written)")

    r = await confirmAs(OLD_ADULT, { ageConfirmed: true, termsAccepted: true })
    assert.strictEqual(r.status, 200)
    const u = db.users.find((x) => x.id === OLD_ADULT)!
    assert.ok(u.age_confirmed_at instanceof Date && u.terms_accepted_at instanceof Date, "timestamps stored")
    assert.strictEqual(u.terms_version, TERMS_VERSION)
    assert.deepStrictEqual(db.consents.map((c) => c.type), ["TERMS_OF_SERVICE", "PRIVACY_POLICY"])
    assert.ok(db.consents.every((c) => c.user_id === OLD_ADULT && c.ip_address === IP && c.version === TERMS_VERSION), "IP and version recorded")
    assert.strictEqual(await meFlag(OLD_ADULT), false, "not asked again")
    ok("confirming stores age_confirmed_at, terms_accepted_at, terms_version and the IP; asked only once")
  }

  // ---- Task B: child profiles without a consent record ---------------------------------------------
  console.log("existing children without consent")
  {
    fresh()
    const list = await pendingFor(PARENT)
    assert.deepStrictEqual(list.map((c) => c.memberId).sort(), [NO_CONSENT, NO_CONSENT_LOGIN].sort())
    assert.strictEqual(list.find((c) => c.memberId === NO_CONSENT_LOGIN)!.hasLogin, true)
    assert.deepStrictEqual(await pendingFor(OLD_ADULT), [], "an adult who isn't a parent isn't asked")
    assert.deepStrictEqual(await pendingFor(STRANGER), [])
    assert.deepStrictEqual(await pendingFor(TEEN), [])
    assert.deepStrictEqual(db.writes, [], "listing deletes or writes nothing")
    assert.strictEqual(db.members.length, 5)
    ok("the family's parent is shown children with no consent record (with or without a login); nobody else is; nothing is deleted")

    let r = await consentCall(OLD_ADULT, "POST", NO_CONSENT, { consent: true })
    assert.strictEqual(r.status, 403)
    r = await consentCall(PARENT, "POST", NO_CONSENT, { consent: false })
    assert.strictEqual(r.status, 400)
    r = await consentCall(PARENT, "POST", NO_CONSENT, {})
    assert.strictEqual(r.status, 400)
    assert.strictEqual(db.parentalConsents.length, 1)
    ok("only a parent can confirm, and only with consent: true")

    // Confirm branch.
    r = await consentCall(PARENT, "POST", NO_CONSENT, { consent: true })
    assert.strictEqual(r.status, 200)
    let row = db.parentalConsents.find((c) => c.child_member_id === NO_CONSENT)!
    assert.strictEqual(row.parent_user_id, PARENT)
    assert.strictEqual(row.scope, "CHILD_PROFILE")
    assert.strictEqual(row.consent_text, CHILD_CONSENT_TEXT)
    assert.strictEqual(row.consent_text_version, CHILD_CONSENT_VERSION)
    assert.strictEqual(row.ip_address, IP)
    assert.strictEqual(row.withdrawn_at, null)
    r = await consentCall(PARENT, "POST", NO_CONSENT_LOGIN, { consent: true })
    assert.strictEqual(r.status, 200)
    row = db.parentalConsents.find((c) => c.child_member_id === NO_CONSENT_LOGIN)!
    assert.strictEqual(row.scope, "CHILD_ACCOUNT")
    assert.strictEqual(row.child_user_id, TEEN)
    assert.deepStrictEqual(await pendingFor(PARENT), [], "not asked again")
    r = await consentCall(PARENT, "POST", NO_CONSENT, { consent: true })
    assert.strictEqual(r.status, 409, "no duplicate record")
    assert.strictEqual(db.members.length, 5, "nothing deleted")
    ok("confirming writes a consent record (profile or account scope, the exact text, IP) and the child keeps everything")

    // Decline branch: the parent withdraws instead.
    fresh()
    r = await consentCall(PARENT, "DELETE", NO_CONSENT, {})
    assert.strictEqual(r.status, 400, "withdrawal needs its own confirmation")
    assert.strictEqual(db.members.length, 5)
    r = await consentCall(PARENT, "DELETE", NO_CONSENT, { confirm: true })
    assert.strictEqual(r.status, 200)
    assert.ok(!db.members.some((m) => m.id === NO_CONSENT), "child member deleted")
    assert.ok(!db.profiles.some((p) => p.family_member_id === NO_CONSENT), "child profile deleted")
    const kept = db.parentalConsents.filter((c) => c.child_member_id === NO_CONSENT)
    assert.strictEqual(kept.length, 1, "a withdrawn record is kept")
    assert.ok(kept[0].withdrawn_at instanceof Date)
    assert.strictEqual(kept[0].withdrawn_by, PARENT)
    assert.strictEqual(kept[0].parent_user_id, PARENT)
    assert.ok(kept[0].consent_text.startsWith(NO_PRIOR_CONSENT_NOTE), "the record says there was no earlier consent")
    assert.ok(db.members.some((m) => m.id === HAS_CONSENT) && db.members.some((m) => m.id === NO_CONSENT_LOGIN), "other children untouched")
    assert.strictEqual(db.parentalConsents.find((c) => c.child_member_id === HAS_CONSENT)!.withdrawn_at, null, "sibling's consent untouched")
    assert.deepStrictEqual((await pendingFor(PARENT)).map((c) => c.memberId), [NO_CONSENT_LOGIN])
    ok("declining then withdrawing deletes that child's data and keeps a withdrawn consent record; siblings untouched")
  }

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
