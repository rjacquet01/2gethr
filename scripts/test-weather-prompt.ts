// Usage: npx tsx --tsconfig tsconfig.json scripts/test-weather-prompt.ts
// The calendar's "add a Home place" weather prompt: status, wording, dismissal.
// No database and no network - the hook's inputs are given directly.
import assert from "node:assert"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { weatherStatusFor, weatherPromptFor, isWeatherPromptDismissed, dismissWeatherPrompt } from "../lib/weather-prompt"
import { WeatherSetupPrompt } from "../components/weather-setup-prompt"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

const FAMILY = "fam-1"
const base = {
  familyId: FAMILY,
  roleLoading: false,
  isGuest: false,
  placesLoaded: true,
  placesError: false,
  hasPlace: false,
  weatherLoaded: false,
  weatherError: false,
}
const render = (status: Parameters<typeof WeatherSetupPrompt>[0]["status"], role: string | null, familyId: string | null = FAMILY) =>
  renderToStaticMarkup(createElement(WeatherSetupPrompt, { status, role, familyId }))

class MemStore {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
}
const g = globalThis as unknown as { window?: unknown }

check("no places + parent: 'Add a Home place' with an Add Home link to /places", () => {
  const status = weatherStatusFor(base)
  assert.strictEqual(status, "no-place")
  for (const role of ["PARENT", "GUARDIAN", "ADULT", "ADMIN"]) assert.strictEqual(weatherPromptFor(status, role), "add")
  const html = render(status, "PARENT")
  assert.match(html, /Add a Home place to see weather on your calendar\./)
  assert.match(html, /<a[^>]*href="\/places"[^>]*>Add Home<\/a>/)
  assert.match(html, /aria-label="Dismiss weather tip"/)
  assert.match(html, /<button[^>]*type="button"/)
})

check("no places + child: 'Ask a parent' and no link", () => {
  assert.strictEqual(weatherPromptFor("no-place", "CHILD"), "ask")
  const html = render("no-place", "CHILD")
  assert.match(html, /Ask a parent to add a Home place to see weather\./)
  assert.doesNotMatch(html, /<a /)
  assert.doesNotMatch(html, /Add Home/)
})

check("guest: status 'guest' and nothing rendered", () => {
  const status = weatherStatusFor({ ...base, isGuest: true, placesLoaded: false })
  assert.strictEqual(status, "guest")
  assert.strictEqual(render(status, "GUEST"), "")
  // Even if a guest somehow got 'no-place', still nothing.
  assert.strictEqual(render("no-place", "GUEST"), "")
})

check("places present: no prompt, and weather goes loading -> ready", () => {
  assert.strictEqual(weatherStatusFor({ ...base, hasPlace: true }), "loading")
  const status = weatherStatusFor({ ...base, hasPlace: true, weatherLoaded: true })
  assert.strictEqual(status, "ready")
  assert.strictEqual(render(status, "PARENT"), "")
})

check("loading and error never show the prompt", () => {
  const cases = [
    weatherStatusFor({ ...base, familyId: undefined }),
    weatherStatusFor({ ...base, roleLoading: true }),
    weatherStatusFor({ ...base, placesLoaded: false }),
    weatherStatusFor({ ...base, placesLoaded: false, placesError: true }),
    weatherStatusFor({ ...base, hasPlace: true, weatherError: true }),
  ]
  assert.deepStrictEqual(cases, ["loading", "loading", "loading", "error", "error"])
  for (const s of cases) for (const role of ["PARENT", "CHILD"]) assert.strictEqual(render(s, role), "")
  assert.strictEqual(render("no-place", null), "", "unknown role (still loading) shows nothing")
})

check("dismissal persists per family", () => {
  const store = new MemStore()
  g.window = { localStorage: store }
  try {
    assert.notStrictEqual(render("no-place", "PARENT"), "")
    dismissWeatherPrompt(FAMILY)
    assert.strictEqual(isWeatherPromptDismissed(FAMILY), true)
    assert.strictEqual(render("no-place", "PARENT"), "", "dismissed family stays hidden on the next visit")
    assert.notStrictEqual(render("no-place", "PARENT", "fam-2"), "", "another family still sees it")
  } finally {
    delete g.window
  }
})

check("storage that throws (or is missing) doesn't crash; banner just shows", () => {
  const broken = { getItem() { throw new Error("blocked") }, setItem() { throw new Error("blocked") } }
  assert.strictEqual(isWeatherPromptDismissed(FAMILY, broken), false)
  assert.doesNotThrow(() => dismissWeatherPrompt(FAMILY, broken))
  g.window = { get localStorage() { throw new Error("SecurityError") } }
  try {
    assert.doesNotThrow(() => dismissWeatherPrompt(FAMILY))
    assert.match(render("no-place", "PARENT"), /Add a Home place/)
  } finally {
    delete g.window
  }
  assert.strictEqual(isWeatherPromptDismissed(FAMILY, null), false)
  assert.match(render("no-place", "CHILD"), /Ask a parent/)
})

console.log(`\n${passed} checks passed`)
