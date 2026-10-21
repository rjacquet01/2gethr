// Usage: npx tsx --tsconfig tsconfig.json scripts/test-push-ownership.ts
// One browser, two accounts: the Settings push toggle reflects the signed-in
// account, signing out releases the device, and nobody can switch off
// another account's device. Real routes on a small stateful in-memory
// push_tokens table (lib/db __setSqlForTests); no real database or network.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "push-own-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "push-own-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "push-own-test-admin-secret-not-real-0123456789"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }
type Row = Record<string, any>

const A = "u-alice"
const B = "u-bob"
// Node defines a read-only navigator; stand in a browser's for each case.
const setNavigator = (value: unknown) =>
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true })

const BROWSER = JSON.stringify({ endpoint: "https://push.example.invalid/one-browser", keys: { p256dh: "k", auth: "a" } })

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const tokenRoute = await import("../app/api/notifications/push-token/route")
  const statusRoute = await import("../app/api/notifications/push-token/status/route")
  const { releasePushForThisDevice } = await import("../lib/push-release")

  let rows: Row[] = []
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.startsWith("INSERT INTO push_tokens")) {
      // ON CONFLICT (token) DO UPDATE: the token moves to this account.
      const [user_id, token, platform, info] = v as string[]
      const existing = rows.find((r) => r.token === token)
      if (existing) Object.assign(existing, { user_id, device_info: JSON.parse(info), is_active: true })
      else rows.push({ user_id, token, platform, device_info: JSON.parse(info), is_active: true })
      return []
    }
    if (q.startsWith("SELECT 1 FROM push_tokens")) return rows.filter((r) => r.token === v[0] && r.user_id === v[1] && r.is_active)
    if (q.startsWith("UPDATE push_tokens SET is_active = false")) {
      for (const r of rows) if (r.token === v[0] && r.user_id === v[1]) r.is_active = false
      return []
    }
    if (q.includes("FROM users") && q.includes("WHERE id =")) return [A, B].includes(v[0] as string) ? [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "X", is_active: true }] : []
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const bearer = async (u: string) => `Bearer ${await generateAccessToken(u)}`
  const call = async (fn: (r: Request) => Promise<Response>, u: string, method: string, body: unknown) =>
    fn(new Request("http://localhost/api/notifications/push-token", {
      method, headers: { "content-type": "application/json", authorization: await bearer(u) }, body: JSON.stringify(body),
    }))
  const turnOn = (u: string, deviceInfo: unknown = { browser: "Chrome on Windows", language: "en-US" }) =>
    call(tokenRoute.POST, u, "POST", { token: BROWSER, platform: "web", deviceInfo })
  const turnOff = (u: string) => call(tokenRoute.DELETE, u, "DELETE", { token: BROWSER })
  const isOn = async (u: string) => (await (await call(statusRoute.POST, u, "POST", { token: BROWSER })).json()).registered

  console.log("one browser, two accounts")
  {
    assert.strictEqual((await turnOn(A)).status, 200)
    assert.strictEqual(await isOn(A), true)
    assert.strictEqual(await isOn(B), false)
    ok("Alice turned push on: on for Alice, off for Bob signed in on the same browser")

    assert.strictEqual((await turnOff(B)).status, 200)
    assert.strictEqual(await isOn(A), true)
    ok("Bob can't switch off Alice's device with its token")

    await turnOn(B)
    assert.strictEqual(await isOn(B), true)
    assert.strictEqual(await isOn(A), false)
    assert.strictEqual(rows.length, 1)
    ok("Bob turning push on moves the browser to Bob (one subscription, one owner)")
  }

  console.log("signing out")
  {
    const sent: { url: string; init: RequestInit }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, init })
      return tokenRoute.DELETE(new Request(`http://localhost${url}`, init))
    }) as unknown as typeof fetch
    setNavigator({
      serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => JSON.parse(BROWSER) } }) },
    })
    await releasePushForThisDevice(await generateAccessToken(B))
    assert.strictEqual(sent.length, 1)
    assert.strictEqual(sent[0].init.method, "DELETE")
    assert.strictEqual(await isOn(B), false)
    ok("logout releases this browser for the account signing out")

    await turnOn(B)
    sent.length = 0
    setNavigator({ serviceWorker: { getRegistration: async () => undefined } })
    await releasePushForThisDevice(await generateAccessToken(B))
    await releasePushForThisDevice(null)
    setNavigator({})
    await releasePushForThisDevice(await generateAccessToken(B))
    setNavigator({ serviceWorker: { getRegistration: async () => { throw new Error("blocked") } } })
    await releasePushForThisDevice(await generateAccessToken(B))
    assert.strictEqual(sent.length, 0)
    assert.strictEqual(await isOn(B), true)
    ok("no service worker, no subscription, signed out already, or an error: nothing sent, never throws")
  }

  console.log("device names")
  {
    await turnOn(A, { browser: "Firefox on Android", language: "fr-FR", userAgent: "x".repeat(500), extra: { nested: true } })
    assert.deepStrictEqual(rows[0].device_info, { browser: "Firefox on Android", language: "fr-FR" })
    await turnOn(A, { browser: "y".repeat(200) })
    assert.strictEqual(rows[0].device_info.browser.length, 60)
    await turnOn(A, "not an object")
    assert.deepStrictEqual(rows[0].device_info, {})
    ok("only a short browser label and language are stored")
  }

  const noToken = await call(statusRoute.POST, A, "POST", {})
  assert.strictEqual(noToken.status, 400)
  const anon = await statusRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { authorization: "Bearer not-a-real-token" }, body: JSON.stringify({ token: BROWSER }) }))
  assert.strictEqual(anon.status, 401)
  ok("status needs a signed-in user and a token")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
