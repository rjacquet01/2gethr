// Usage: npx tsx --tsconfig tsconfig.json scripts/test-admin-delete-child.ts
// Admin "Delete child profile" (no login), through the real route, on a small
// stateful in-memory database (lib/db __setSqlForTests). Nothing touches a
// real database: DATABASE_URL points at a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "admin-child-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "admin-child-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "admin-child-test-admin-secret-not-real-0123456789"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>

const FAMILY = "fam-1"
const PARENT_MEMBER = "m-parent"
const CHILD = "m-child-a"     // no login: the one to delete
const SIBLING = "m-child-b"   // no login: must survive
const TEEN = "m-child-c"      // has a login: refused here
const ADMIN = "admin-1"
const WEAK_ADMIN = "admin-2"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const route = await import("../app/api/admin/families/[familyId]/children/[memberId]/route")

  // ---- stateful fake database ------------------------------------------------------------------
  let db!: {
    members: Row[]
    profiles: Row[]
    locationSettings: Row[]
    consents: Row[]
    adminLog: Row[]
    writes: string[]
  }
  const fresh = () => {
    db = {
      members: [
        { id: PARENT_MEMBER, family_id: FAMILY, user_id: "u-parent", role: "PARENT" },
        { id: CHILD, family_id: FAMILY, user_id: null, role: "CHILD" },
        { id: SIBLING, family_id: FAMILY, user_id: null, role: "CHILD" },
        { id: TEEN, family_id: FAMILY, user_id: "u-teen", role: "CHILD" },
      ],
      profiles: [
        { family_member_id: CHILD, display_name: "Ava" },
        { family_member_id: SIBLING, display_name: "Ben" },
        { family_member_id: TEEN, display_name: "Cal" },
      ],
      locationSettings: [{ family_member_id: CHILD }, { family_member_id: SIBLING }],
      consents: [
        { id: "pc-a", family_id: FAMILY, child_member_id: CHILD, withdrawn_at: null, withdrawn_by: null },
        { id: "pc-b", family_id: FAMILY, child_member_id: SIBLING, withdrawn_at: null, withdrawn_by: null },
      ],
      adminLog: [],
      writes: [],
    }
  }
  fresh()
  const admins: Record<string, { roles: string[]; permissions: string[] }> = {
    [ADMIN]: { roles: ["SUPPORT"], permissions: ["families.read", "families.update"] },
    [WEAK_ADMIN]: { roles: ["READ_ONLY"], permissions: ["families.read"] },
  }

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) db.writes.push(q)
    if (q.includes("FROM admin_users")) return admins[v[0] as string] ? [{ id: v[0], email: `${v[0]}@example.invalid`, status: "ACTIVE", mfa_enabled: true }] : []
    if (q.includes("FROM admin_roles r")) return (admins[v[0] as string]?.roles ?? []).map((name) => ({ name }))
    if (q.includes("SELECT DISTINCT p.key")) return (admins[v[0] as string]?.permissions ?? []).map((key) => ({ key }))
    if (q.startsWith("INSERT INTO admin_action_logs")) { db.adminLog.push({ admin: v[0], action: v[1], targetType: v[2], targetId: v[3], metadata: JSON.parse(String(v[4])) }); return [] }
    // Route: the child row (member + profile name).
    if (q.startsWith("SELECT fm.id, fm.user_id, fm.role, cp.display_name")) {
      const m = db.members.find((x) => x.id === v[0] && x.family_id === v[1])
      return m ? [{ ...m, display_name: db.profiles.find((p) => p.family_member_id === m.id)?.display_name ?? null }] : []
    }
    // deleteChildData's lookup.
    if (q.startsWith("SELECT fm.id, fm.user_id, fm.role, u.email")) {
      const m = db.members.find((x) => x.id === v[0] && x.family_id === v[1] && x.role === "CHILD")
      return m ? [{ ...m, email: null }] : []
    }
    if (q.startsWith("UPDATE parental_consents SET withdrawn_at")) {
      for (const c of db.consents) if (c.child_member_id === v[1] && c.family_id === v[2] && !c.withdrawn_at) { c.withdrawn_at = new Date(); c.withdrawn_by = v[0] }
      return []
    }
    if (q.startsWith("DELETE FROM family_members")) {
      const [id, fam] = v as string[]
      const gone = db.members.filter((m) => m.id === id && m.family_id === fam && m.role === "CHILD").map((m) => m.id)
      db.members = db.members.filter((m) => !gone.includes(m.id))
      // ON DELETE CASCADE in the real schema:
      db.profiles = db.profiles.filter((p) => !gone.includes(p.family_member_id))
      db.locationSettings = db.locationSettings.filter((l) => !gone.includes(l.family_member_id))
      return []
    }
    if (q.startsWith("DELETE FROM parental_consents")) throw new Error("consent rows must never be deleted")
    return [] // schema ensures, invite revocation, etc.
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const adminToken = (id: string) =>
    generateAdminAccessToken({ id, email: `${id}@example.invalid`, firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: true, ...admins[id] } as Parameters<typeof generateAdminAccessToken>[0])
  const call = async (memberId: string, body: unknown, token: string | null) => {
    const req = new NextRequest(`http://localhost/api/admin/families/${FAMILY}/children/${memberId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.4", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    return route.DELETE(req, { params: Promise.resolve({ familyId: FAMILY, memberId }) })
  }
  const good = { reason: "Parent request by email on 2026-10-20, verified from the address on file", confirm: "DELETE" }
  const untouched = () => {
    assert.strictEqual(db.members.length, 4, "no member deleted")
    assert.strictEqual(db.profiles.length, 3, "no profile deleted")
    assert.ok(db.consents.every((c) => !c.withdrawn_at), "no consent withdrawn")
    assert.deepStrictEqual(db.adminLog, [], "no audit entry")
  }

  // 1. Only admins with families.update.
  console.log("access")
  {
    fresh()
    assert.strictEqual((await call(CHILD, good, null)).status, 401)
    const appUserToken = await generateAccessToken("u-parent")
    assert.strictEqual((await call(CHILD, good, appUserToken)).status, 401, "a regular app login is not an admin")
    const r = await call(CHILD, good, await adminToken(WEAK_ADMIN))
    assert.strictEqual(r.status, 403)
    untouched()
    ok("no token or an app user's token: 401; an admin without families.update: 403; nothing changed")
  }

  // 2. Input checks.
  console.log("input")
  {
    fresh()
    const t = await adminToken(ADMIN)
    let r = await call(CHILD, { confirm: "DELETE" }, t)
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /reason/i)
    r = await call(CHILD, { reason: "   ", confirm: "DELETE" }, t)
    assert.strictEqual(r.status, 400, "a blank reason doesn't count")
    r = await call(CHILD, { reason: good.reason }, t)
    assert.strictEqual(r.status, 400, "typed DELETE confirmation required")
    r = await call(CHILD, { reason: good.reason, confirm: "delete" }, t)
    assert.strictEqual(r.status, 400)
    untouched()
    ok("missing or blank reason, or no exact DELETE confirmation: 400, nothing changed")
  }

  // 3. Refusals.
  console.log("refusals")
  {
    fresh()
    const t = await adminToken(ADMIN)
    let r = await call(TEEN, good, t)
    assert.strictEqual(r.status, 400)
    assert.match((await r.json()).error, /own login/)
    r = await call(PARENT_MEMBER, good, t)
    assert.strictEqual(r.status, 404, "not a child")
    r = await call("m-nobody", good, t)
    assert.strictEqual(r.status, 404)
    untouched()
    ok("a child with a login is refused (close the account instead); a parent or unknown id is 404")
  }

  // 4. Success.
  console.log("delete")
  {
    fresh()
    const r = await call(CHILD, good, await adminToken(ADMIN))
    assert.strictEqual(r.status, 200)
    assert.ok(!db.members.some((m) => m.id === CHILD), "child membership deleted")
    assert.ok(!db.profiles.some((p) => p.family_member_id === CHILD), "child profile deleted")
    assert.ok(!db.locationSettings.some((l) => l.family_member_id === CHILD), "location settings deleted")
    ok("the child's membership, profile and location settings are deleted")

    assert.deepStrictEqual(db.members.map((m) => m.id).sort(), [PARENT_MEMBER, SIBLING, TEEN].sort(), "everyone else stays")
    assert.ok(db.profiles.some((p) => p.family_member_id === SIBLING) && db.locationSettings.some((l) => l.family_member_id === SIBLING))
    ok("siblings and parents are left intact")

    const a = db.consents.find((c) => c.id === "pc-a")!
    assert.ok(a, "consent row kept")
    assert.ok(a.withdrawn_at instanceof Date)
    assert.strictEqual(a.withdrawn_by, ADMIN)
    assert.strictEqual(db.consents.find((c) => c.id === "pc-b")!.withdrawn_at, null, "sibling's consent untouched")
    ok("the child's consent row is kept and marked withdrawn by the admin; the sibling's is untouched")

    assert.strictEqual(db.adminLog.length, 1)
    const log = db.adminLog[0]
    assert.deepStrictEqual(
      [log.admin, log.action, log.targetId, log.metadata.familyId, log.metadata.childMemberId, log.metadata.reason, log.metadata.childName],
      [ADMIN, "DELETE_CHILD_PROFILE", CHILD, FAMILY, CHILD, good.reason, "Ava"]
    )
    ok("audit entry: admin id, family id, child id, reason (and the child's name)")
  }

  __setSqlForTests(null)
  console.log(`\nAll ${passed} admin delete-child checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
