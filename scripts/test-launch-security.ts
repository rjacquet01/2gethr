// Usage: npx tsx --tsconfig tsconfig.json scripts/test-launch-security.ts
// Launch security fixes, through the real routes, on an in-memory fake
// database (lib/db __setSqlForTests). Nothing touches a real database:
// DATABASE_URL points at a closed local port, and email is not configured.
import assert from "node:assert"
import fs from "node:fs"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "launch-sec-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "launch-sec-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "launch-sec-test-admin-secret-not-real-0123456789"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
delete process.env.RESEND_API_KEY
delete process.env.ADMIN_MFA_OPTIONAL

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>
const FAMILY = "fam-1"
const OWNER = "u-owner"
const COPARENT = "u-coparent"
const TEEN = "u-teen"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { generateAdminAccessToken, generateAdminRefreshToken, getAdminFromToken } = await import("../lib/admin-auth")
  const { collectUserExport } = await import("../lib/data-export")
  const { NextRequest } = await import("next/server")
  const memberRoute = await import("../app/api/families/[familyId]/members/[memberId]/route")
  const adminUserRoute = await import("../app/api/admin/users/[userId]/route")
  const adminLogout = await import("../app/api/admin/auth/logout/route")
  const adminMe = await import("../app/api/admin/auth/me/route")

  // ---- fake database ----------------------------------------------------------------------------
  let members: Row[] = []
  let admins: Record<string, { roles: string[]; permissions: string[]; mfa: boolean }> = {}
  const log: { q: string; v: unknown[] }[] = []
  const fresh = () => {
    log.length = 0
    members = [
      { id: "m-owner", family_id: FAMILY, user_id: OWNER, role: "PARENT", is_active: true },
      { id: "m-coparent", family_id: FAMILY, user_id: COPARENT, role: "PARENT", is_active: true },
      { id: "m-teen", family_id: FAMILY, user_id: TEEN, role: "CHILD", is_active: true },
      { id: "m-adult", family_id: FAMILY, user_id: "u-adult", role: "ADULT", is_active: true },
    ]
    admins = {
      "a-support": { roles: ["SUPPORT_ADMIN"], permissions: ["users.read", "users.update"], mfa: true },
      "a-nomfa": { roles: ["SUPER_ADMIN"], permissions: [], mfa: false },
    }
  }
  fresh()
  const users: Record<string, Row> = {
    [OWNER]: { id: OWNER, email: "owner@example.invalid", first_name: "Olive", is_active: true },
    [COPARENT]: { id: COPARENT, email: "co@example.invalid", first_name: "Cory", is_active: true },
    [TEEN]: { id: TEEN, email: "teen@example.invalid", first_name: "Tess", is_active: true },
  }
  // Export: memberships the user has (one active, one they were removed from, one as a guest).
  let exportMemberships: Row[] = []

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    log.push({ q, v })
    if (q.includes("FROM admin_users")) {
      const a = admins[v[0] as string]
      return a ? [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "A", last_name: "Admin", status: "ACTIVE", mfa_enabled: a.mfa }] : []
    }
    if (q.includes("FROM admin_roles r")) return (admins[v[0] as string]?.roles ?? []).map((name) => ({ name }))
    if (q.includes("SELECT DISTINCT p.key")) return (admins[v[0] as string]?.permissions ?? []).map((key) => ({ key }))
    if (q.includes("FROM users WHERE id =") || q.startsWith("SELECT id, email, first_name, is_active FROM users")) {
      const u = users[v[0] as string]
      return u ? [u] : []
    }
    if (q.startsWith("SELECT role FROM family_members")) {
      const m = members.find((x) => x.family_id === v[0] && x.user_id === v[1] && x.is_active)
      return m ? [{ role: m.role }] : []
    }
    if (q.startsWith("SELECT 1 FROM families f")) {
      const isParent = members.some((m) => m.family_id === v[0] && m.user_id === v[2] && m.is_active && m.role === "PARENT")
      return v[1] === OWNER || isParent ? [{ "?column?": 1 }] : []
    }
    if (q.startsWith("SELECT fm.id, fm.user_id, fm.role, f.owner_id")) {
      const m = members.find((x) => x.id === v[0] && x.family_id === v[1])
      return m ? [{ ...m, owner_id: OWNER }] : []
    }
    if (q.startsWith("SELECT fm.family_id, fm.role, f.owner_id")) {
      return exportMemberships.filter((m) => !q.includes("fm.is_active = true") || m.is_active)
    }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)
  const writes = (needle: string) => log.filter((x) => /^(INSERT|UPDATE|DELETE)/.test(x.q) && x.q.includes(needle))

  const userReq = async (as: string, method: string, path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${await generateAccessToken(as)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const memberCtx = (memberId: string) => ({ params: Promise.resolve({ familyId: FAMILY, memberId }) })
  const adminUser = (id: string) => ({ id, email: `${id}@example.invalid`, firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: admins[id].mfa, roles: admins[id].roles, permissions: admins[id].permissions })
  const quiet = async <T,>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

  // 1. A parent can't turn a co-parent (or any adult) into a "child", or a child into an adult.
  console.log("member roles")
  {
    for (const [target, role] of [["m-coparent", "CHILD"], ["m-adult", "CHILD"], ["m-teen", "ADULT"], ["m-teen", "PARENT"]] as const) {
      fresh()
      const r = await memberRoute.PATCH(await userReq(OWNER, "PATCH", `/api/families/${FAMILY}/members/${target}`, { role }), memberCtx(target))
      assert.strictEqual(r.status, 403, `${target} -> ${role}`)
      assert.deepStrictEqual(writes("family_members"), [], "nothing changed")
      assert.deepStrictEqual(writes("child_profiles"), [], "no child profile made")
    }
    ok("PATCH refuses changing anyone into or out of the child role (403, nothing written)")

    fresh()
    const r = await memberRoute.PATCH(await userReq(COPARENT, "PATCH", `/api/families/${FAMILY}/members/m-adult`, { role: "GUEST" }), memberCtx("m-adult"))
    assert.strictEqual(r.status, 200)
    assert.strictEqual(writes("UPDATE family_members").length, 1)
    ok("other role changes still work (adult -> guest)")

    fresh()
    const d = await memberRoute.DELETE(await userReq(TEEN, "DELETE", `/api/families/${FAMILY}/members/m-teen`), memberCtx("m-teen"))
    assert.strictEqual(d.status, 403)
    assert.deepStrictEqual(writes("family_members"), [])
    assert.deepStrictEqual(writes("users"), [], "child's login not closed")
    ok("a child can't remove themselves (which would delete their profile and login)")
  }

  // 2. Data export: only families the user is still in; no saved places for guests.
  console.log("data export")
  {
    exportMemberships = [
      { family_id: "fam-active", role: "PARENT", owner_id: "someone", is_active: true },
      { family_id: "fam-removed", role: "PARENT", owner_id: "someone", is_active: false },
      { family_id: "fam-guest", role: "GUEST", owner_id: "someone", is_active: true },
    ]
    log.length = 0
    await quiet(() => collectUserExport(COPARENT))
    const lookup = log.find((x) => x.q.startsWith("SELECT fm.family_id, fm.role, f.owner_id"))!
    assert.ok(lookup.q.includes("fm.is_active = true"), "membership lookup is active-only")
    const roster = log.find((x) => x.q.includes("FROM family_members fm JOIN families f ON f.id = fm.family_id JOIN users u"))!
    assert.deepStrictEqual(roster.v[0], ["fam-active", "fam-guest"], "roster only for families they're still in")
    const places = log.find((x) => x.q.includes("FROM saved_places sp"))!
    assert.deepStrictEqual(places.v[0], ["fam-active"], "saved places: not the removed family, not as a guest")
    ok("export leaves out families the user was removed from, and saved places where they're a guest")
  }

  // 3. The open "send any notification" endpoint is gone (it let a child fake an SOS push).
  assert.ok(!fs.existsSync("app/api/notifications/send/route.ts"))
  ok("POST /api/notifications/send no longer exists")

  // 4. Admin "reset password" emails a link; no admin ever sees or sets a password.
  console.log("admin password reset")
  {
    fresh()
    const token = await generateAdminAccessToken(adminUser("a-support") as never)
    const req = new NextRequest(`http://localhost/api/admin/users/${COPARENT}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "reset_password", reason: "user asked" }),
    })
    const r = await quiet(() => adminUserRoute.PATCH(req, { params: Promise.resolve({ userId: COPARENT }) }))
    const body = await r.json()
    assert.strictEqual(body.tempPassword, undefined, "no password in the response")
    assert.deepStrictEqual(log.filter((x) => x.q.includes("password_hash")), [], "password never changed by the admin")
    assert.strictEqual(r.status, 503, "email not configured in this test, so it says so")
    assert.strictEqual(writes("INSERT INTO password_reset_tokens").length, 1, "a one-hour reset token was created for the user")
    ok("reset sends the user a reset link (here: 503 because email is off), returns no password, never sets one")
  }

  // 5. Admin logout ends the sessions, from the Bearer token or (if that expired) the refresh token.
  console.log("admin logout")
  {
    fresh()
    const access = await generateAdminAccessToken(adminUser("a-support") as never)
    let r = await adminLogout.POST(new NextRequest("http://localhost/api/admin/auth/logout", { method: "POST", headers: { authorization: `Bearer ${access}` } }))
    assert.strictEqual(r.status, 200)
    let revoke = writes("UPDATE admin_sessions")
    assert.strictEqual(revoke.length, 1)
    assert.strictEqual(revoke[0].v[0], "a-support")
    ok("logout with the Bearer token revokes the admin's sessions")

    fresh()
    const refresh = await generateAdminRefreshToken(adminUser("a-support") as never)
    r = await adminLogout.POST(new NextRequest("http://localhost/api/admin/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer expired-or-garbage" },
      body: JSON.stringify({ refreshToken: refresh }),
    }))
    revoke = writes("UPDATE admin_sessions")
    assert.strictEqual(revoke.length, 1, "revoked via the refresh token")
    assert.strictEqual(revoke[0].v[0], "a-support")
    fresh()
    r = await adminLogout.POST(new NextRequest("http://localhost/api/admin/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: access }),
    }))
    assert.deepStrictEqual(writes("UPDATE admin_sessions"), [], "an access token is not accepted as a refresh token")
    ok("with an expired access token, a valid refresh token still ends the sessions")
  }

  // 6. Two-step sign-in is required in production.
  console.log("admin MFA")
  {
    fresh()
    const env = process.env as Record<string, string | undefined>
    const prevEnv = env.NODE_ENV
    const token = await generateAdminAccessToken(adminUser("a-nomfa") as never)
    try {
      env.NODE_ENV = "production"
      assert.strictEqual(await getAdminFromToken(token), null, "API refuses an admin without MFA")
      assert.ok(await getAdminFromToken(token, { allowWithoutMfa: true }), "setup routes still accept them")
      const me = await adminMe.GET(new NextRequest("http://localhost/api/admin/auth/me", { headers: { authorization: `Bearer ${token}` } }))
      assert.strictEqual(me.status, 200)
      assert.strictEqual((await me.json()).admin.mfaSetupRequired, true, "portal is told to show the setup screen")
      const withMfa = await generateAdminAccessToken(adminUser("a-support") as never)
      assert.ok(await getAdminFromToken(withMfa), "an admin with MFA on is fine")
      env.ADMIN_MFA_OPTIONAL = "true"
      assert.ok(await getAdminFromToken(token), "ADMIN_MFA_OPTIONAL=true lifts it (emergency)")
    } finally {
      env.NODE_ENV = prevEnv
      delete env.ADMIN_MFA_OPTIONAL
    }
    assert.ok(await getAdminFromToken(token), "not required outside production (local dev)")
    ok("production refuses admins without two-step sign-in except on me/MFA setup/logout; env override works")
  }

  __setSqlForTests(null)
  console.log(`\nAll ${passed} launch security checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
