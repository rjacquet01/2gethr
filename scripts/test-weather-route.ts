// Usage: npx tsx --tsconfig tsconfig.json scripts/test-weather-route.ts
// The calendar forecast providers (lib/weather.ts), with fetch mocked: the
// US National Weather Service mapping, which provider is tried first with
// and without OPEN_METEO_API_KEY, falling back when the first fails or the
// place is outside the US, NWS headers, rounded coordinates, and that the key
// never shows up in a response, an error or a log line. No network, no
// database (the route test uses an in-memory fake for the signed-in user).
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "weather-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "weather-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "weather-test-admin-secret-not-real-0123456789"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }
const KEY = "om_test_KEY_s3cr3t+/="

type Call = { url: string; init?: RequestInit }

async function main() {
  const weather = await import("../lib/weather")
  const { forecastUrl, fetchForecast, fetchNwsForecast, mapNwsPeriods, nwsCode, nwsWind, redactKey, NWS_USER_AGENT } = weather
  const route = await import("../app/api/weather/route")
  const { NextRequest } = await import("next/server")
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")

  // --- NWS sample: Tuesday 10/20 (day + night), Wednesday, and a night-only Thursday start.
  const periods = [
    { startTime: "2026-10-20T06:00:00-04:00", isDaytime: true, temperature: 61, temperatureUnit: "F", probabilityOfPrecipitation: { value: 20 }, windSpeed: "5 to 10 mph", shortForecast: "Partly Sunny" },
    { startTime: "2026-10-20T18:00:00-04:00", isDaytime: false, temperature: 44, temperatureUnit: "F", probabilityOfPrecipitation: { value: null }, windSpeed: "5 mph", shortForecast: "Chance Rain Showers" },
    { startTime: "2026-10-21T06:00:00-04:00", isDaytime: true, temperature: 70, temperatureUnit: "F", probabilityOfPrecipitation: { value: 80 }, windSpeed: "10 to 15 mph", shortForecast: "Showers And Thunderstorms" },
    { startTime: "2026-10-21T18:00:00-04:00", isDaytime: false, temperature: 52, temperatureUnit: "F", probabilityOfPrecipitation: { value: 40 }, windSpeed: "20 mph", shortForecast: "Mostly Cloudy" },
    { startTime: "2026-10-22T18:00:00-04:00", isDaytime: false, temperature: 39, temperatureUnit: "F", probabilityOfPrecipitation: null, windSpeed: "", shortForecast: "Areas Of Fog" },
  ]
  const nwsDays = {
    "2026-10-20": { code: 2, hi: 61, lo: 44, rain: 20, wind: 10 },
    "2026-10-21": { code: 95, hi: 70, lo: 52, rain: 80, wind: 20 },
    "2026-10-22": { code: 45, hi: 39, lo: 39, rain: 0, wind: 0 },
  }
  const omJson = {
    daily: { time: ["2026-10-20"], weather_code: [3], temperature_2m_max: [61.4], temperature_2m_min: [44.6], precipitation_probability_max: [20], wind_speed_10m_max: [9.6] },
  }

  // --- fetch mock: every provider answers per `mode`.
  const calls: Call[] = []
  const mode = { nwsPoints: 200 as number | "throw", nwsForecast: 200 as number, om: 200 as number | "throw" }
  const mainFetch = (async (u: string | URL, init?: RequestInit) => {
    const url = String(u)
    calls.push({ url, init })
    if (url.startsWith("https://api.weather.gov/points/")) {
      if (mode.nwsPoints === "throw") throw new Error("nws down")
      if (mode.nwsPoints !== 200) return new Response("{}", { status: mode.nwsPoints })
      return new Response(JSON.stringify({ properties: { forecast: "https://api.weather.gov/gridpoints/BOX/71,90/forecast", timeZone: "America/New_York" } }), { status: 200 })
    }
    if (url.startsWith("https://api.weather.gov/gridpoints/")) {
      if (mode.nwsForecast !== 200) return new Response("{}", { status: mode.nwsForecast })
      return new Response(JSON.stringify({ properties: { periods } }), { status: 200 })
    }
    if (url.includes("open-meteo.com")) {
      if (mode.om === "throw") throw new Error(`connect failed for ${url}`)
      if (mode.om !== 200) return new Response("nope", { status: mode.om })
      return new Response(JSON.stringify(omJson), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
  globalThis.fetch = mainFetch
  const reset = (m: Partial<typeof mode> = {}) => { calls.length = 0; Object.assign(mode, { nwsPoints: 200, nwsForecast: 200, om: 200 }, m) }
  const hosts = () => calls.map((c) => new URL(c.url).host)

  // --- capture logs to prove the key never appears in them.
  const logs: string[] = []
  for (const k of ["log", "warn", "error"] as const) {
    const orig = console[k].bind(console)
    console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); if (k === "log") orig(...a) }
  }

  console.log("NWS mapping")
  {
    assert.deepStrictEqual(mapNwsPeriods(periods, "America/New_York"), nwsDays)
    ok("day/night periods -> hi (day), lo (night), max rain (null -> 0), max wind, code from the day's forecast")

    const codes: Record<string, number> = {
      "Sunny": 0, "Clear": 0, "Mostly Clear": 2, "Partly Cloudy": 2, "Mostly Sunny": 2, "Partly Sunny": 2,
      "Mostly Cloudy": 3, "Cloudy": 3, "Overcast": 3, "Patchy Fog": 45, "Haze": 45, "Drizzle": 51,
      "Rain": 61, "Chance Rain": 61, "Rain Showers Likely": 80, "Chance Showers": 80,
      "Snow": 71, "Light Snow Likely": 71, "Rain And Snow": 71, "Slight Chance T-storms": 95,
      "Showers And Thunderstorms Likely": 95, "Blowing Dust": 3, "": 3,
    }
    for (const [text, code] of Object.entries(codes)) assert.strictEqual(nwsCode(text), code, text)
    assert.strictEqual(nwsWind("10 to 15 mph"), 15)
    assert.strictEqual(nwsWind("5 mph"), 5)
    assert.strictEqual(nwsWind(undefined), 0)
    ok("shortForecast -> WMO-style codes (unknown -> 3); windSpeed takes the top of the range")

    assert.deepStrictEqual(
      mapNwsPeriods([{ startTime: "2026-10-20T02:30:00Z", isDaytime: false, temperature: 10, temperatureUnit: "C", probabilityOfPrecipitation: { value: 5 }, windSpeed: "3 mph", shortForecast: "Clear" }], "America/Los_Angeles"),
      { "2026-10-19": { code: 0, hi: 50, lo: 50, rain: 5, wind: 3 } }
    )
    ok("dates are the place's own day (time zone), Celsius converted defensively")
  }

  console.log("provider order without a key")
  delete process.env.OPEN_METEO_API_KEY
  {
    reset()
    const f = await fetchForecast(42.123456, -71.98765)
    assert.strictEqual(f.source, "nws")
    assert.deepStrictEqual(f.days, nwsDays)
    assert.deepStrictEqual(hosts(), ["api.weather.gov", "api.weather.gov"], "points, then its forecast link; Open-Meteo not called")
    assert.strictEqual(calls[0].url, "https://api.weather.gov/points/42.12,-71.99", "coordinates rounded to 2 decimals")
    for (const c of calls) {
      const h = new Headers(c.init?.headers)
      assert.strictEqual(h.get("user-agent"), NWS_USER_AGENT)
      assert.strictEqual(h.get("accept"), "application/geo+json")
      assert.ok(c.init?.signal, "timed out after 8 seconds")
      assert.strictEqual((c.init as { next?: { revalidate?: number } }).next?.revalidate, 1800)
    }
    ok("no key: NWS first (rounded point, User-Agent, geo+json, 8 s timeout, 30 min cache); Open-Meteo untouched")

    for (const m of [{ nwsPoints: 404 }, { nwsPoints: 500 }, { nwsPoints: "throw" as const }, { nwsForecast: 503 }]) {
      reset(m)
      logs.length = 0
      const g = await fetchForecast(42.123456, -71.98765)
      assert.strictEqual(g.source, "open-meteo", JSON.stringify(m))
      assert.deepStrictEqual(g.days["2026-10-20"], { code: 3, hi: 61, lo: 45, rain: 20, wind: 10 })
      const om = calls.find((c) => c.url.includes("open-meteo"))!
      const u = new URL(om.url)
      assert.strictEqual(u.origin + u.pathname, "https://api.open-meteo.com/v1/forecast", "the free endpoint")
      assert.strictEqual(u.searchParams.get("apikey"), null)
      assert.strictEqual(u.searchParams.get("latitude"), "42.12")
      assert.strictEqual(u.searchParams.get("longitude"), "-71.99")
      const warn = logs.filter((l) => l.startsWith("Weather:"))
      assert.strictEqual(warn.length, 1, "one warning line")
      assert.ok(warn[0].includes("42.12,-71.99") && !warn[0].includes("42.1234"), "only rounded coordinates")
      if (m.nwsPoints === 404) assert.ok(warn[0].includes("outside NWS coverage"))
    }
    ok("no key: outside the US (404), NWS errors or a dead forecast link fall back to free Open-Meteo with one warning")

    reset()
    mode.nwsPoints = 200
    globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
      const url = String(u)
      calls.push({ url, init })
      if (url.startsWith("https://api.weather.gov/points/")) return new Response(JSON.stringify({ properties: { forecast: "https://evil.example/forecast" } }), { status: 200 })
      if (url.includes("open-meteo.com")) return new Response(JSON.stringify(omJson), { status: 200 })
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch
    await assert.rejects(fetchNwsForecast(42.12, -71.99), /no forecast link/)
    assert.ok(!calls.some((c) => c.url.includes("evil.example")), "never follows a link off api.weather.gov")
    ok("a forecast link that isn't api.weather.gov is never fetched")
  }

  // Back to the main mock.
  globalThis.fetch = mainFetch

  console.log("provider order with a key")
  process.env.OPEN_METEO_API_KEY = KEY
  {
    reset()
    const f = await fetchForecast(42.123456, -71.98765)
    assert.strictEqual(f.source, "open-meteo")
    assert.deepStrictEqual(hosts(), ["customer-api.open-meteo.com"], "NWS not called")
    const u = new URL(calls[0].url)
    assert.strictEqual(u.searchParams.get("apikey"), KEY)
    assert.strictEqual(u.searchParams.get("latitude"), "42.12")
    assert.strictEqual(new URL(forecastUrl(1, 2)).host, "customer-api.open-meteo.com")
    assert.ok(!JSON.stringify(f).includes(KEY) && !JSON.stringify(f).includes(encodeURIComponent(KEY)))
    ok("key set: keyed Open-Meteo first; NWS untouched; key not in the data")

    for (const m of [{ om: 500 }, { om: "throw" as const }]) {
      reset(m)
      logs.length = 0
      const g = await fetchForecast(42.123456, -71.98765)
      assert.strictEqual(g.source, "nws", JSON.stringify(m))
      assert.deepStrictEqual(g.days, nwsDays)
      assert.deepStrictEqual(hosts(), ["customer-api.open-meteo.com", "api.weather.gov", "api.weather.gov"])
    }
    ok("key set: Open-Meteo down or unreachable -> NWS answers")

    reset({ om: "throw", nwsPoints: 404 })
    await assert.rejects(fetchForecast(48.85, 2.35), (e: Error) =>
      !e.message.includes(KEY) && !e.message.includes(encodeURIComponent(KEY)) && e.message.includes("[redacted]") && e.message.includes("nws"))
    ok("key set, both fail (outside the US): one key-free error naming both")
    assert.strictEqual(redactKey(`x ${KEY} y ${encodeURIComponent(KEY)}`), "x [redacted] y [redacted]")
  }

  console.log("route")
  {
    const USER = "u-weather"
    __setSqlForTests((async (strings: TemplateStringsArray, ...v: unknown[]) => {
      const q = strings.join("?").replace(/\s+/g, " ")
      if (q.includes("FROM users") && q.includes("WHERE id =") && v[0] === USER) {
        return [{ id: USER, email: "w@example.invalid", first_name: "W", last_name: "", is_active: true }]
      }
      return []
    }) as unknown as Parameters<typeof __setSqlForTests>[0])

    reset()
    const out = await route.GET(new NextRequest("http://localhost/api/weather?lat=42.12&lng=-71.99", { headers: { authorization: "Bearer not-a-real-token" } }))
    assert.strictEqual(out.status, 401)
    assert.strictEqual(calls.length, 0, "nothing fetched for a signed-out request")

    const auth = { authorization: `Bearer ${await generateAccessToken(USER)}` }
    reset()
    let r = await route.GET(new NextRequest("http://localhost/api/weather?lat=42.12&lng=-71.99", { headers: auth }))
    let body = await r.json()
    assert.strictEqual(r.status, 200)
    assert.strictEqual(body.source, "open-meteo")
    assert.deepStrictEqual(Object.keys(body.data), ["2026-10-20"])

    delete process.env.OPEN_METEO_API_KEY
    reset()
    r = await route.GET(new NextRequest("http://localhost/api/weather?lat=42.12&lng=-71.99", { headers: auth }))
    body = await r.json()
    assert.strictEqual(body.source, "nws")
    assert.deepStrictEqual(body.data, nwsDays)

    process.env.OPEN_METEO_API_KEY = KEY
    reset({ om: "throw", nwsPoints: 500 })
    r = await route.GET(new NextRequest("http://localhost/api/weather?lat=42.12&lng=-71.99", { headers: auth }))
    const text = await r.text()
    assert.strictEqual(r.status, 502)
    assert.ok(!text.includes(KEY) && !text.includes(encodeURIComponent(KEY)))
    __setSqlForTests(null)
    ok("route: 401 signed out (nothing fetched); data + source when signed in; 502 with no key in the body")
  }

  assert.ok(logs.length > 0, "logs were captured")
  assert.ok(logs.every((l) => !l.includes(KEY) && !l.includes(encodeURIComponent(KEY))), "no key in any log line")
  ok(`no key in any of the ${logs.length} captured log lines`)

  console.log(`\nAll ${passed} weather route checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
