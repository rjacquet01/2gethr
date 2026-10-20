// Usage: npx tsx --tsconfig tsconfig.json scripts/test-weather-route.ts
// Which Open-Meteo endpoint is called with and without OPEN_METEO_API_KEY
// (fetch is mocked), that coordinates stay rounded, and that the key never
// shows up in a response, an error or a log line. No network, no database.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "weather-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "weather-test-refresh-secret-not-real-0123456789"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }
const KEY = "om_test_KEY_s3cr3t+/="

async function main() {
  const { forecastUrl, fetchForecast, redactKey } = await import("../lib/weather")
  const route = await import("../app/api/weather/route")
  const { NextRequest } = await import("next/server")

  const calls: string[] = []
  let reply: () => Promise<Response> = async () =>
    new Response(JSON.stringify({
      daily: { time: ["2026-10-20"], weather_code: [3], temperature_2m_max: [61.4], temperature_2m_min: [44.6], precipitation_probability_max: [20], wind_speed_10m_max: [9.6] },
    }), { status: 200 })
  globalThis.fetch = (async (url: string | URL) => { calls.push(String(url)); return reply() }) as typeof fetch

  // Without a key: the free endpoint, exactly as before.
  delete process.env.OPEN_METEO_API_KEY
  {
    const days = await fetchForecast(42.123456, -71.98765)
    assert.strictEqual(calls.length, 1)
    const u = new URL(calls[0])
    assert.strictEqual(u.origin + u.pathname, "https://api.open-meteo.com/v1/forecast")
    assert.strictEqual(u.searchParams.get("latitude"), "42.12")
    assert.strictEqual(u.searchParams.get("longitude"), "-71.99")
    assert.strictEqual(u.searchParams.get("apikey"), null)
    assert.strictEqual(u.searchParams.get("forecast_days"), "16")
    assert.deepStrictEqual(days["2026-10-20"], { code: 3, hi: 61, lo: 45, rain: 20, wind: 10 })
    ok("no key: free api.open-meteo.com, no apikey, coordinates rounded to 2 decimals")
  }

  // With a key: the customer endpoint plus apikey, same query otherwise.
  process.env.OPEN_METEO_API_KEY = KEY
  {
    calls.length = 0
    const days = await fetchForecast(42.123456, -71.98765)
    const u = new URL(calls[0])
    assert.strictEqual(u.origin + u.pathname, "https://customer-api.open-meteo.com/v1/forecast")
    assert.strictEqual(u.searchParams.get("apikey"), KEY)
    assert.strictEqual(u.searchParams.get("latitude"), "42.12")
    delete process.env.OPEN_METEO_API_KEY
    const free = new URL(forecastUrl(42.123456, -71.98765))
    process.env.OPEN_METEO_API_KEY = KEY
    u.searchParams.delete("apikey")
    assert.strictEqual(u.searchParams.toString(), free.searchParams.toString(), "same query apart from the key")
    assert.ok(!JSON.stringify(days).includes(KEY) && !JSON.stringify(days).includes(encodeURIComponent(KEY)))
    ok("key set: customer-api.open-meteo.com with apikey; same query; key not in the data")
  }

  // Failures: errors and logs never carry the key.
  {
    reply = async () => { throw new Error(`connect failed for ${forecastUrl(1, 2)}`) }
    await assert.rejects(fetchForecast(1, 2), (e: Error) => !e.message.includes(KEY) && !e.message.includes(encodeURIComponent(KEY)) && e.message.includes("[redacted]"))
    reply = async () => new Response("nope", { status: 500 })
    await assert.rejects(fetchForecast(1, 2), (e: Error) => e.message === "upstream 500")
    assert.strictEqual(redactKey(`x ${KEY} y ${encodeURIComponent(KEY)}`), "x [redacted] y [redacted]")
    ok("network and upstream errors never contain the key")
  }

  // Route: still requires sign-in, and answers before any upstream call.
  {
    calls.length = 0
    const req = new NextRequest("http://localhost/api/weather?lat=42.12&lng=-71.99", { headers: { authorization: "Bearer not-a-real-token" } })
    const r = await route.GET(req)
    assert.strictEqual(r.status, 401)
    const body = await r.text()
    assert.ok(!body.includes(KEY))
    assert.strictEqual(calls.length, 0, "no forecast fetched for a signed-out request")
    ok("route: signed-out request is 401, nothing fetched, no key in the body")
  }

  console.log(`\nAll ${passed} weather route checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
