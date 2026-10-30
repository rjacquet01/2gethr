// Usage: npx tsx --tsconfig tsconfig.json scripts/test-site-data.ts
// A browser that blocks site data for mytogethr.com (every localStorage access
// throws a SecurityError) must get a clear message, not "Network error", and
// the token helpers must never throw. Pure: a fake window, no network.
import assert from "node:assert"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

class SecurityError extends Error {
  constructor() { super("Failed to read the 'localStorage' property from 'Window': Access is denied for this document."); this.name = "SecurityError" }
}

const store = new Map<string, string>()
const working = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
const g = globalThis as unknown as { window?: unknown }
const setStorageState = (blocked: boolean) => {
  g.window = blocked
    ? Object.defineProperty({}, "localStorage", { get() { throw new SecurityError() } })
    : { localStorage: working }
  ;(globalThis as unknown as { localStorage?: unknown }).localStorage = blocked ? undefined : working
}

async function main() {
  const site = await import("../lib/site-data")
  const auth = await import("../hooks/use-auth")

  setStorageState(false)
  assert.equal(site.siteDataBlocked(), false)
  auth.setTokens("access-1", "refresh-1")
  assert.equal(auth.getAccessToken(), "access-1")
  assert.equal(auth.getRefreshToken(), "refresh-1")
  assert.ok(!store.has("__togethr_storage_probe"), "the probe leaves nothing behind")
  auth.clearTokens()
  assert.equal(auth.getAccessToken(), null)
  ok("storage allowed: not blocked; tokens stored, read and cleared")

  setStorageState(true)
  assert.equal(site.siteDataBlocked(), true)
  assert.doesNotThrow(() => auth.setTokens("a", "r"))
  assert.equal(auth.getAccessToken(), null)
  assert.equal(auth.getRefreshToken(), null)
  assert.doesNotThrow(() => auth.clearTokens())
  ok("storage blocked: detected, and the token helpers never throw")

  assert.ok(/blocking site data/i.test(site.SITE_DATA_BLOCKED_MESSAGE) && /mytogethr\.com/.test(site.SITE_DATA_BLOCKED_MESSAGE))
  assert.ok(!/network/i.test(site.SITE_DATA_BLOCKED_MESSAGE))
  ok("the message names the cause and the site, not a network error")

  delete g.window
  assert.equal(site.siteDataBlocked(), false, "on the server nothing is blocked")
  assert.equal(site.readStored("x"), null)
  ok("server side: no window, no throw")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
