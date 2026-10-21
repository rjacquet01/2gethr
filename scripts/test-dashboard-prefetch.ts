// Usage: npx tsx --tsconfig tsconfig.json scripts/test-dashboard-prefetch.ts
// The dashboard preload (hooks/use-dashboard-prefetch.ts) asks for exactly
// the requests the dashboard page and its widgets make, so the page finds
// them already loaded. fetch and localStorage are faked; no network, no
// database.
import assert from "node:assert"
import fs from "node:fs"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

// A browser-ish environment: storage with a session token, and fetch recorded.
const store = new Map<string, string>()
const g = globalThis as unknown as Record<string, unknown>
g.window = g
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
}
const fetched: string[] = []
g.fetch = async (url: string) => {
  fetched.push(String(url))
  return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
}

async function main() {
  const { prefetchDashboard, dashboardEventFilters, remindersKey } = await import("../hooks/use-dashboard-prefetch")
  const { eventsKey } = await import("../hooks/use-events")
  const { tasksKey } = await import("../hooks/use-tasks")
  const { subscriptionKey } = await import("../hooks/use-subscription")
  const { locationKey } = await import("../components/dashboard-extras")
  const { activityKey, presenceKey } = await import("../components/dashboard-widgets")
  const { rememberLastFamily, readLastFamily, forgetLastFamily } = await import("../lib/last-family")

  const FAM = "fam 1/é" // odd characters: keys must still match exactly
  const settle = () => new Promise((r) => setTimeout(r, 20))

  console.log("what the preload asks for")
  {
    rememberLastFamily(FAM, "PARENT")
    prefetchDashboard()
    await settle()
    const expected = [
      eventsKey(dashboardEventFilters(FAM)), tasksKey(FAM), subscriptionKey(FAM), remindersKey(FAM),
      locationKey(FAM), activityKey(FAM), presenceKey(FAM),
    ]
    assert.deepStrictEqual([...fetched].sort(), [...expected].sort() as string[])
    ok("a parent's dashboard: events (today + 7 days), tasks, plan, reminders, map, activity, presence")

    fetched.length = 0
    prefetchDashboard()
    await settle()
    assert.deepStrictEqual(fetched, [], "already in SWR's preload cache: not fetched twice")
    ok("a second preload reuses the requests already started")
  }

  console.log("guests and first visits")
  {
    fetched.length = 0
    rememberLastFamily("fam-guest", "GUEST")
    prefetchDashboard()
    await settle()
    assert.deepStrictEqual([...fetched].sort(), [
      eventsKey(dashboardEventFilters("fam-guest")), tasksKey("fam-guest"), subscriptionKey("fam-guest"), remindersKey("fam-guest"),
    ].sort() as string[])
    ok("a guest: no map, activity or presence requests (the server refuses those)")

    fetched.length = 0
    forgetLastFamily()
    assert.strictEqual(readLastFamily(), null)
    prefetchDashboard()
    await settle()
    assert.deepStrictEqual(fetched, [])
    store.set("togethr:last-family", "{not json")
    assert.strictEqual(readLastFamily(), null)
    prefetchDashboard()
    await settle()
    assert.deepStrictEqual(fetched, [])
    ok("nothing remembered (first visit, signed out, or bad data): no requests")
  }

  console.log("same keys as the page")
  {
    const a = dashboardEventFilters("f", new Date(2026, 9, 21, 15, 30))
    const b = dashboardEventFilters("f", new Date(2026, 9, 21, 0, 1))
    assert.deepStrictEqual(a, b, "the whole day maps to one key")
    assert.strictEqual(new Date(a.endDate!).getTime() - new Date(a.startDate!).getTime() >= 6.9 * 86400_000, true)
    const page = fs.readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
    assert.ok(page.includes("dashboardEventFilters(primaryFamily.id)"), "page builds its event range the same way")
    assert.ok(page.includes("remindersKey(primaryFamily.id)") && page.includes("remindersFetcher"), "page loads reminders by the same key")
    for (const [file, needle] of [
      ["hooks/use-events.ts", "const url = eventsKey(filters)"],
      ["hooks/use-tasks.ts", "const url = tasksKey(familyId, status)"],
      ["hooks/use-subscription.ts", "subscriptionKey(familyId),"],
      ["components/dashboard-extras.tsx", "familyId ? locationKey(familyId) : null"],
      ["components/dashboard-widgets.tsx", "familyId ? activityKey(familyId) : null"],
      ["components/dashboard-widgets.tsx", "familyId ? presenceKey(familyId) : null"],
    ]) assert.ok(fs.readFileSync(file, "utf8").includes(needle), `${file} uses the shared key`)
    const layout = fs.readFileSync("app/(dashboard)/layout.tsx", "utf8")
    assert.ok(/pathname === '\/dashboard' && getAccessToken\(\)\) prefetchDashboard\(\)/.test(layout), "layout starts it with a stored session only")
    const auth = fs.readFileSync("hooks/use-auth.ts", "utf8")
    assert.ok(auth.includes("forgetLastFamily()"), "sign-out forgets the family")
    assert.ok(auth.includes("if (primaryFamilyId && !readLastFamily()) rememberLastFamily(primaryFamilyId, primaryFamilyRole)"), "signing in remembers the account's family when none is remembered")
    ok("page, widgets and hooks all build their keys with the shared functions; layout and sign-out wired")
  }

  console.log(`\n${passed} passed`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
