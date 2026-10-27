// Usage: npx tsx --tsconfig tsconfig.json scripts/test-location-history-delete.ts
// A person's stored location history (location points and arrival/departure
// records) is deleted when they turn location sharing off and when their
// account is deleted, and nothing else is (privacy policy section 4). Also
// the proxy marking the Android app (?source=android-app) with a cookie.
// In-memory fake database (lib/db __setSqlForTests): DATABASE_URL points at
// a closed local port, nothing real is touched.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "loc-history-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "loc-history-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "loc-history-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const FAMILY = "fam-1"
const ME = "u-me"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const settingsRoute = await import("../app/api/location/settings/route")
  const { closeUserAccount } = await import("../lib/account-closure")
  const { proxy } = await import("../proxy")

  const state = {
    settings: { mode: "ACTIVE", share_with_family: true } as Record<string, unknown>,
    sharingElsewhere: false,
    legalHold: false,
    deletes: [] as { q: string; v: unknown[] }[],
  }
  const reset = () => {
    state.settings = { mode: "ACTIVE", share_with_family: true }
    state.sharingElsewhere = false
    state.legalHold = false
    state.deletes = []
  }
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.startsWith("DELETE")) state.deletes.push({ q, v })
    if (q.startsWith("WITH u AS")) {
      return [{ id: v[0], email: "me@example.invalid", first_name: "Me", last_name: "", is_active: true,
        member_id: "m-me", role: "PARENT", family_id: FAMILY, family_name: "Testers", owner_id: ME }]
    }
    if (q.includes("SELECT fm.role, fm.family_id, target.user_id")) {
      return [{ role: "PARENT", family_id: FAMILY, target_user_id: ME, target_role: "PARENT" }]
    }
    if (q.includes("SELECT tier, status, trial_ends_at")) return [{ tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null }]
    if (q.includes("SELECT id, mode, share_with_family FROM location_settings")) return [{ id: "ls-1", ...state.settings }]
    if (q.startsWith("UPDATE location_settings")) {
      if (v[0] !== null && v[0] !== undefined) state.settings.mode = v[0]
      if (v[1] !== null && v[1] !== undefined) state.settings.share_with_family = v[1]
      return []
    }
    // lib/location-history: still sharing with any family?
    if (q.startsWith("SELECT 1 FROM location_settings ls")) {
      const here = state.settings.mode !== "OFF" && state.settings.share_with_family === true
      return here || state.sharingElsewhere ? [{ "?column?": 1 }] : []
    }
    if (q.includes("FROM legal_cases c")) return state.legalHold ? [{ "?column?": 1 }] : []
    if (q.startsWith("SELECT COUNT(*)::int AS n FROM location_settings")) return [{ n: 0 }]
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const token = await generateAccessToken(ME)
  const patch = async (body: Record<string, unknown>) => {
    const res = await settingsRoute.PATCH(new NextRequest("http://localhost/api/location/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ memberId: "m-me", ...body }),
    }))
    assert.strictEqual(res.status, 200, JSON.stringify(await res.clone().json()))
  }
  const historyDeletes = () => state.deletes.map((d) => d.q.match(/^DELETE FROM (\w+)/)?.[1])

  // 1. Turning sharing off deletes the person's location points and arrival records, and nothing else.
  reset()
  await patch({ mode: "OFF" })
  assert.deepStrictEqual(historyDeletes(), ["location_pings", "geofence_events"])
  assert.ok(state.deletes.every((d) => d.v.length === 1 && d.v[0] === ME), "only this person's rows")
  reset()
  await patch({ shareWithFamily: false })
  assert.deepStrictEqual(historyDeletes(), ["location_pings", "geofence_events"])
  ok("sharing turned off (mode OFF, or share with family off): this person's location history deleted, nothing else")

  // 2. Pausing is not turning off.
  reset()
  await patch({ mode: "PAUSED" })
  assert.deepStrictEqual(historyDeletes(), [])
  ok("pausing keeps the history")

  // 3. Still sharing with another family: the points serve that family, so they stay.
  reset()
  state.sharingElsewhere = true
  await patch({ mode: "OFF" })
  assert.deepStrictEqual(historyDeletes(), [])
  ok("still sharing with another family: history kept")

  // 4. A legal hold keeps it (same rule as every other delete).
  reset()
  state.legalHold = true
  await patch({ mode: "OFF" })
  assert.deepStrictEqual(historyDeletes(), [])
  ok("legal hold: history kept")

  // 5. Changing something else while sharing deletes nothing.
  reset()
  await patch({ updateIntervalSec: 600 })
  assert.deepStrictEqual(historyDeletes(), [])
  reset()
  state.settings = { mode: "OFF", share_with_family: false }
  await patch({ updateIntervalSec: 600 })
  assert.deepStrictEqual(historyDeletes(), [], "a one-time Share now point survives an unrelated change")
  ok("other setting changes (sharing on or already off): nothing deleted")

  // 6. Account deletion removes the person's location history (and only theirs).
  reset()
  await closeUserAccount({ id: ME, email: "me@example.invalid" })
  const loc = state.deletes.filter((d) => /^DELETE FROM (location_pings|geofence_events) WHERE user_id = \?$/.test(d.q))
  assert.deepStrictEqual(loc.map((d) => d.q.split(" ")[2]), ["location_pings", "geofence_events"])
  assert.ok(loc.every((d) => d.v[0] === ME))
  ok("account deletion: this person's location points and arrival records deleted")

  // 7. The proxy marks the Android app: ?source=android-app sets the cookie for later pages
  //    and for this same request; other visits are untouched; the API's CSRF check is unchanged.
  const pageReq = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers })
  let res = proxy(pageReq("https://mytogethr.com/?source=android-app"))
  const setCookie = res.headers.get("set-cookie") ?? ""
  assert.match(setCookie, /togethr_android=1/)
  assert.match(setCookie, /Path=\//i)
  assert.ok(!/Max-Age|Expires/i.test(setCookie), "a session cookie, like the page's own")
  assert.match(res.headers.get("x-middleware-request-cookie") ?? "", /togethr_android=1/, "this request sees it too")
  res = proxy(pageReq("https://mytogethr.com/dashboard", { referer: "android-app://com.togethrapp.mobile/" }))
  assert.match(res.headers.get("set-cookie") ?? "", /togethr_android=1/, "the android-app:// referrer works the same")
  res = proxy(pageReq("https://mytogethr.com/pricing"))
  assert.strictEqual(res.headers.get("set-cookie"), null, "a website visit gets no cookie")
  const cross = proxy(new NextRequest("https://mytogethr.com/api/reminders", { method: "POST", headers: { origin: "https://evil.example", host: "mytogethr.com" } }))
  assert.strictEqual(cross.status, 403, "cross-site API POST still refused")
  const same = proxy(new NextRequest("https://mytogethr.com/api/reminders", { method: "POST", headers: { origin: "https://mytogethr.com", host: "mytogethr.com" } }))
  assert.notStrictEqual(same.status, 403)
  ok("proxy: ?source=android-app or the app referrer sets the cookie (this request too); website untouched; API CSRF unchanged")

  __setSqlForTests(null)
  console.log(`\n${passed} checks passed`)
}

main().then(() => process.exit(0), (err) => {
  console.error(err)
  process.exit(1)
})
