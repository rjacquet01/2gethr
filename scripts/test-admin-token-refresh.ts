// Usage: npx tsx --tsconfig tsconfig.json scripts/test-admin-token-refresh.ts
// Admin "Unauthorized" after 15 minutes: the admin access token expired and
// nothing renewed it. Checks lib/admin-token-refresh (fake storage and fetch)
// and that a SUPER_ADMIN who also holds LEGAL_COMPLIANCE can resolve a ticket
// through the real PATCH route on an in-memory database (lib/db
// __setSqlForTests). Nothing touches a real database: DATABASE_URL points at
// a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "token-refresh-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "token-refresh-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "token-refresh-test-admin-secret-not-real-0123456789"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, unknown>

const MIN = 60 * 1000

function jwtWithExp(expMs: number, tag = "x"): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(expMs / 1000), tag })}.sig`
}

async function main() {
  const refresh = await import("../lib/admin-token-refresh")
  const { ensureFreshAdminToken, adminTokenExpiresAt, ADMIN_ACCESS_TOKEN_KEY: A, ADMIN_REFRESH_TOKEN_KEY: R } = refresh

  const now = Date.UTC(2026, 9, 26, 12, 0, 0)
  const makeEnv = (store: Record<string, string>, respond: () => Promise<Response>) => {
    const calls: string[] = []
    const env = {
      storage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v },
      },
      fetch: (async (url: string) => { calls.push(url); return respond() }) as unknown as typeof fetch,
      now: () => now,
    }
    return { env, calls }
  }
  const okResponse = (access: string, refreshToken: string) => async () =>
    new Response(JSON.stringify({ accessToken: access, refreshToken }), { status: 200 })

  // 1. Expiry is read from the token.
  assert.strictEqual(adminTokenExpiresAt(jwtWithExp(now + 10 * MIN)), Math.floor((now + 10 * MIN) / 1000) * 1000)
  assert.strictEqual(adminTokenExpiresAt("not-a-jwt"), null)
  ok("reads the token expiry; a malformed token has none")

  // 2. A token with plenty of time left is used as is.
  {
    const fresh = jwtWithExp(now + 10 * MIN)
    const { env, calls } = makeEnv({ [A]: fresh, [R]: "r1" }, okResponse("never", "never"))
    assert.strictEqual(await ensureFreshAdminToken(env), fresh)
    assert.strictEqual(calls.length, 0)
  }
  ok("fresh token: no refresh")

  // 3. An expired token (the bug: 15+ minutes after sign-in) is refreshed and stored.
  {
    const store: Record<string, string> = { [A]: jwtWithExp(now - MIN), [R]: "r1" }
    const next = jwtWithExp(now + 15 * MIN, "new")
    const { env, calls } = makeEnv(store, okResponse(next, "r2"))
    assert.strictEqual(await ensureFreshAdminToken(env), next)
    assert.deepStrictEqual(calls, ["/api/admin/auth/refresh"])
    assert.strictEqual(store[A], next)
    assert.strictEqual(store[R], "r2")
  }
  ok("expired token: refreshed, new pair stored")

  // 4. Near expiry (inside the margin) also refreshes.
  {
    const next = jwtWithExp(now + 15 * MIN, "new")
    const { env, calls } = makeEnv({ [A]: jwtWithExp(now + 2 * MIN), [R]: "r1" }, okResponse(next, "r2"))
    assert.strictEqual(await ensureFreshAdminToken(env), next)
    assert.strictEqual(calls.length, 1)
  }
  ok("token about to expire: refreshed early")

  // 5. Several callers at once share one refresh (refresh tokens rotate).
  {
    const next = jwtWithExp(now + 15 * MIN, "new")
    const { env, calls } = makeEnv({ [A]: jwtWithExp(now - MIN), [R]: "r1" }, okResponse(next, "r2"))
    const results = await Promise.all([ensureFreshAdminToken(env), ensureFreshAdminToken(env), ensureFreshAdminToken(env)])
    assert.deepStrictEqual(results, [next, next, next])
    assert.strictEqual(calls.length, 1)
  }
  ok("concurrent callers: one refresh request")

  // 6. Refresh rejected and nobody else rotated: null (sign in again).
  {
    const { env } = makeEnv({ [A]: jwtWithExp(now - MIN), [R]: "r1" }, async () => new Response("{}", { status: 401 }))
    assert.strictEqual(await ensureFreshAdminToken(env), null)
  }
  ok("refresh rejected: null")

  // 7. Refresh rejected because another tab rotated the pair meanwhile: use that tab's token.
  {
    const store: Record<string, string> = { [A]: jwtWithExp(now - MIN), [R]: "r1" }
    const otherTab = jwtWithExp(now + 15 * MIN, "other-tab")
    const { env } = makeEnv(store, async () => {
      store[A] = otherTab
      store[R] = "r2-other-tab"
      return new Response("{}", { status: 401 })
    })
    assert.strictEqual(await ensureFreshAdminToken(env), otherTab)
  }
  ok("another tab refreshed first: its token is used")

  // 8. The ticket route: SUPER_ADMIN + LEGAL_COMPLIANCE, no explicit permissions, can resolve.
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAdminAccessToken, hasPermission } = await import("../lib/admin-auth")
  const { NextRequest } = await import("next/server")
  const ticketRoute = await import("../app/api/admin/tickets/[ticketId]/route")

  const ADMIN = "admin-1"
  const ticket: Row = { id: "t-1", status: "IN_PROGRESS", resolved_at: null, closed_at: null, resolution_notes: null }
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.includes("FROM admin_users")) return v[0] === ADMIN ? [{ id: ADMIN, email: "a@example.invalid", status: "ACTIVE", mfa_enabled: true }] : []
    if (q.includes("FROM admin_roles r")) return v[0] === ADMIN ? [{ name: "LEGAL_COMPLIANCE" }, { name: "SUPER_ADMIN" }] : []
    if (q.includes("SELECT DISTINCT p.key")) return [{ key: "legal.read" }]
    if (q.startsWith("SELECT * FROM support_tickets")) return v[0] === ticket.id ? [{ ...ticket }] : []
    if (q.startsWith("UPDATE support_tickets SET status")) { ticket.status = v[0]; return [] }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const admin = { id: ADMIN, email: "a@example.invalid", firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: true, roles: ["LEGAL_COMPLIANCE", "SUPER_ADMIN"], permissions: ["legal.read"] }
  assert.ok(hasPermission(admin, "support.update"))
  ok("hasPermission: a second role doesn't hide SUPER_ADMIN")

  const token = await generateAdminAccessToken(admin as Parameters<typeof generateAdminAccessToken>[0])
  const patch = (bearer: string | null) => new NextRequest("http://localhost/api/admin/tickets/t-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ action: "update_status", status: "RESOLVED" }),
  })
  const params = { params: Promise.resolve({ ticketId: "t-1" }) }

  const res = await ticketRoute.PATCH(patch(token), params)
  assert.strictEqual(res.status, 200)
  assert.strictEqual(ticket.status, "RESOLVED")
  ok("Mark Resolved: 200 for SUPER_ADMIN + LEGAL_COMPLIANCE")

  ticket.status = "IN_PROGRESS"
  const missing = await ticketRoute.PATCH(patch(null), params)
  assert.strictEqual(missing.status, 401)
  assert.strictEqual(ticket.status, "IN_PROGRESS")
  ok("no token: still 401, ticket unchanged")

  __setSqlForTests(null)
  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
