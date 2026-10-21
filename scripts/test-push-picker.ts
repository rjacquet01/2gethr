// Usage: npx tsx --tsconfig tsconfig.json scripts/test-push-picker.ts
// Admin test-push picker (GET/POST /api/test-push), through the real route,
// on an in-memory fake database (lib/db __setSqlForTests). Nothing touches a
// real database (DATABASE_URL points at a closed local port) and nothing is
// pushed: global fetch is replaced, so encrypted pushes are captured here.
import assert from "node:assert"
import { generateKeyPairSync, randomBytes } from "node:crypto"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "push-picker-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "push-picker-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "push-picker-test-admin-secret-not-real-0123456789"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }
type Row = Record<string, unknown>

// A browser-style push subscription with real P-256 keys (needed for encryption).
function subscription(endpoint: string) {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-65)
  return JSON.stringify({ endpoint, keys: { p256dh: raw.toString("base64url"), auth: randomBytes(16).toString("base64url") } })
}

async function main() {
  const { generateVAPIDKeys } = await import("../lib/services/web-push-vapid")
  const vapid = generateVAPIDKeys()
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey

  const { __setSqlForTests } = await import("../lib/db")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const route = await import("../app/api/test-push/route")

  const SECRET_ENDPOINT = "https://push.example.invalid/send/SECRET-ENDPOINT-abc123"
  const tokens: Row[] = [
    { user_id: "u-ray", email: "ray@example.invalid", first_name: "Ray", platform: "web", device_info: { browser: "Chrome on Windows" }, created_at: "2026-10-20T10:00:00Z", token: subscription(SECRET_ENDPOINT) },
    { user_id: "u-ray", email: "ray@example.invalid", first_name: "Ray", platform: "android", device_info: null, created_at: "2026-10-19T10:00:00Z", token: subscription("https://push.example.invalid/send/other-device") },
    { user_id: "u-max", email: "max@example.invalid", first_name: "Max", platform: "web", device_info: "Safari", created_at: "2026-10-18T10:00:00Z", token: subscription("https://push.example.invalid/send/max") },
  ]
  const admins: Record<string, string[]> = { "a-super": ["SUPER_ADMIN"], "a-support": ["SUPPORT_ADMIN"] }
  const log: { q: string; v: unknown[] }[] = []

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    log.push({ q, v })
    if (q.includes("FROM admin_users")) return admins[v[0] as string] ? [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "A", last_name: "Admin", status: "ACTIVE", mfa_enabled: true }] : []
    if (q.includes("FROM admin_roles r")) return (admins[v[0] as string] ?? []).map((name) => ({ name }))
    if (q.includes("SELECT DISTINCT p.key")) return []
    // GET: one row per account (the grouping itself is SQL; the test checks the query).
    if (q.startsWith("SELECT u.id AS user_id, u.email")) {
      const byUser = new Map<string, Row>()
      for (const t of tokens) {
        const a = byUser.get(t.user_id as string) ?? { user_id: t.user_id, email: t.email, first_name: t.first_name, last_name: null, device_count: 0, platforms: [] as string[], last_registered_at: t.created_at }
        a.device_count = (a.device_count as number) + 1
        if (!(a.platforms as string[]).includes(t.platform as string)) (a.platforms as string[]).push(t.platform as string)
        byUser.set(t.user_id as string, a)
      }
      return [...byUser.values()]
    }
    // POST: the devices to send to.
    if (q.startsWith("SELECT pt.*, u.email, u.first_name")) {
      return q.includes("u.email = ANY") ? tokens.filter((t) => (v[0] as string[]).includes(t.email as string)) : tokens
    }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const pushed: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    pushed.push(String(url))
    return new Response("", { status: 201 })
  }) as typeof fetch

  const req = async (as: string, method: string, body?: unknown) =>
    new Request("http://localhost/api/test-push", {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await generateAdminAccessToken({ id: as, email: `${as}@example.invalid`, firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: true, roles: admins[as], permissions: [] } as never)}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  console.log("account list (GET)")
  {
    const r = await route.GET(await req("a-super", "GET"))
    assert.strictEqual(r.status, 200)
    const text = await r.text()
    const body = JSON.parse(text)
    assert.deepStrictEqual(body.accounts, [
      { userId: "u-ray", email: "ray@example.invalid", name: "Ray", deviceCount: 2, platforms: ["web", "android"], lastRegisteredAt: "2026-10-20T10:00:00Z" },
      { userId: "u-max", email: "max@example.invalid", name: "Max", deviceCount: 1, platforms: ["web"], lastRegisteredAt: "2026-10-18T10:00:00Z" },
    ])
    assert.strictEqual(body.registeredDevices, 3)
    assert.strictEqual(body.totalAccounts, 2)
    ok("one entry per account with device count, platforms and last registration")

    for (const leak of ["SECRET-ENDPOINT", "p256dh", "auth", "endpoint", "token"]) assert.ok(!text.includes(leak), `response contains ${leak}`)
    const q = log.find((x) => x.q.startsWith("SELECT u.id AS user_id"))!.q
    assert.ok(!/LIMIT/i.test(q), "no LIMIT")
    assert.ok(!/pt\.\*|pt\.token/.test(q), "token column not selected")
    assert.ok(/GROUP BY u\.id/.test(q) && /pt\.is_active = true/.test(q))
    ok("no tokens, endpoints or keys in the response; no LIMIT; active devices only")

    const denied = await route.GET(await req("a-support", "GET"))
    assert.strictEqual(denied.status, 401)
    ok("non-super admins can't list accounts")
  }

  console.log("sending (POST)")
  {
    log.length = 0
    pushed.length = 0
    const r = await route.POST(await req("a-super", "POST", { emails: ["ray@example.invalid"] }))
    const text = await r.text()
    const body = JSON.parse(text)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(body.totalDevices, 2)
    assert.deepStrictEqual(body.results.map((x: Row) => [x.email, x.device, x.status]), [
      ["ray@example.invalid", "web · Chrome on Windows", "sent"],
      ["ray@example.invalid", "android", "sent"],
    ])
    assert.strictEqual(pushed.length, 2, "pushed to both of Ray's devices only")
    assert.ok(!pushed.some((u) => u.includes("/max")), "Max not pushed")
    assert.ok(!text.includes("SECRET-ENDPOINT") && !text.includes("p256dh"), "no endpoint or keys in the result")
    ok("one email: only that account's devices, with a result per device")

    const audit = log.filter((x) => x.q.startsWith("INSERT INTO admin_action_logs"))
    assert.strictEqual(audit.length, 1)
    assert.deepStrictEqual([audit[0].v[0], audit[0].v[1]], ["a-super", "TEST_PUSH_SENT"])
    assert.deepStrictEqual(JSON.parse(audit[0].v[4] as string), { target: ["ray@example.invalid"], devices: 2, sent: 2, failed: 0 })
    ok("each test send is written to the admin audit log")

    pushed.length = 0
    for (const bad of [undefined, {}, { emails: [] }, { emails: [""] }]) {
      const res = await route.POST(await req("a-super", "POST", bad))
      assert.strictEqual(res.status, 400, JSON.stringify(bad))
    }
    assert.strictEqual(pushed.length, 0)
    ok("no body or an empty list is refused, never treated as \"everyone\"")

    const all = await route.POST(await req("a-super", "POST", { all: true }))
    assert.strictEqual((await all.json()).totalDevices, 3)
    assert.strictEqual(pushed.length, 3)
    ok("{ all: true } reaches every device")

    pushed.length = 0
    globalThis.fetch = (async () => new Response(`no such subscription ${SECRET_ENDPOINT}`, { status: 404 })) as typeof fetch
    const failed = await (await route.POST(await req("a-super", "POST", { emails: ["max@example.invalid"] }))).json()
    assert.strictEqual(failed.results[0].status, "failed")
    assert.ok(!JSON.stringify(failed).includes("SECRET-ENDPOINT"), "endpoint stripped from the error")
    ok("failures are reported per device without echoing the endpoint")

    const support = await route.POST(await req("a-support", "POST", { emails: ["ray@example.invalid"] }))
    assert.strictEqual(support.status, 401)
    ok("non-super admins can't send")
  }

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
