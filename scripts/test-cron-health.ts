// Usage: npx tsx --tsconfig tsconfig.json scripts/test-cron-health.ts
// Scheduled-job monitoring (lib/cron-health.ts) and the System Health
// settings checks (lib/system-health.ts). Pure logic plus an in-memory fake
// database; DATABASE_URL points at a closed local port.
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { CRON_JOBS, cronIntervalMinutes, lateAfterMinutes, jobState, alertsDue, monitorCron } = await import("../lib/cron-health")
  const { serviceChecks } = await import("../lib/system-health")
  const { NextRequest } = await import("next/server")

  // ---- schedules ---------------------------------------------------------------------------------
  assert.equal(cronIntervalMinutes("* * * * *"), 1)
  assert.equal(cronIntervalMinutes("*/5 * * * *"), 5)
  assert.equal(cronIntervalMinutes("0 * * * *"), 60)
  assert.equal(cronIntervalMinutes("30 9 * * *"), 1440)
  assert.equal(cronIntervalMinutes("0 13,14 * * 0"), 7 * 1440)
  assert.equal(lateAfterMinutes(1), 16)
  assert.equal(lateAfterMinutes(1440), 1440 + 360)
  ok("intervals and grace periods from cron schedules")

  // Every cron route is scheduled, wrapped, and named after its folder.
  const cronDir = path.join(process.cwd(), "app", "api", "cron")
  const dirs = fs.readdirSync(cronDir).filter((d) => fs.existsSync(path.join(cronDir, d, "route.ts")))
  const names = CRON_JOBS.map((j) => j.name).sort()
  assert.deepEqual(names, [...dirs].sort(), "every cron folder is in vercel.json and vice versa")
  for (const d of dirs) {
    const src = fs.readFileSync(path.join(cronDir, d, "route.ts"), "utf8")
    assert.ok(src.includes(`export const GET = monitorCron("${d}", runJob)`), `${d} records its runs`)
    assert.ok(!/export async function GET/.test(src), `${d} has no unmonitored GET`)
  }
  ok(`all ${dirs.length} cron routes are scheduled and monitored`)

  // ---- states ------------------------------------------------------------------------------------
  const now = new Date("2026-10-26T12:00:00Z")
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
  const daily = { name: "archive", path: "/api/cron/archive", schedule: "0 9 * * *", intervalMin: 1440 }
  const minutely = { name: "process-reminders", path: "/api/cron/process-reminders", schedule: "* * * * *", intervalMin: 1 }
  const row = (o: Record<string, unknown>) => ({
    job: "x", last_finished_at: null, last_ok_at: null, last_error_at: null, last_error: null,
    last_status: null, last_duration_ms: null, alerted_at: null, created_at: minutesAgo(5), ...o,
  })
  assert.equal(jobState(daily, undefined, now), "waiting")
  assert.equal(jobState(daily, row({ created_at: minutesAgo(60) }), now), "waiting")
  assert.equal(jobState(daily, row({ created_at: minutesAgo(1801) }), now), "late")
  assert.equal(jobState(minutely, row({ last_finished_at: minutesAgo(2), last_ok_at: minutesAgo(2) }), now), "ok")
  assert.equal(jobState(minutely, row({ last_finished_at: minutesAgo(20), last_ok_at: minutesAgo(20) }), now), "late")
  assert.equal(jobState(daily, row({ last_finished_at: minutesAgo(1500), last_ok_at: minutesAgo(1500) }), now), "ok")
  assert.equal(
    jobState(minutely, row({ last_finished_at: minutesAgo(1), last_ok_at: minutesAgo(3), last_error_at: minutesAgo(1) }), now),
    "failing"
  )
  assert.equal(
    jobState(minutely, row({ last_finished_at: minutesAgo(1), last_ok_at: minutesAgo(1), last_error_at: minutesAgo(3) }), now),
    "ok"
  )
  ok("waiting, ok, late and failing")

  // ---- alerts ------------------------------------------------------------------------------------
  const health = (name: string, state: string, alertedAt: string | null) =>
    ({ ...daily, name, state, alertedAt, lastRunAt: null, lastOkAt: null, lastErrorAt: null, lastError: null, lastDurationMs: null }) as never
  const due = alertsDue(
    [
      health("new-bad", "late", null),
      health("told-recently", "failing", minutesAgo(60)),
      health("told-yesterday", "late", minutesAgo(25 * 60)),
      health("recovered", "ok", minutesAgo(30)),
      health("fine", "ok", null),
      health("starting", "waiting", null),
    ],
    now
  )
  assert.deepEqual(due.bad.map((j: { name: string }) => j.name), ["new-bad", "told-yesterday"])
  assert.deepEqual(due.recovered.map((j: { name: string }) => j.name), ["recovered"])
  ok("alert once, again daily, and once on recovery")

  // ---- recording runs ----------------------------------------------------------------------------
  const writes: { status: unknown; error: unknown }[] = []
  __setSqlForTests(((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?")
    if (text.includes("INSERT INTO cron_runs")) writes.push({ status: values[4], error: values[3] })
    return Promise.resolve([])
  }) as never)
  const req = () => new NextRequest("http://localhost/api/cron/test")
  const { NextResponse } = await import("next/server")
  await monitorCron("t", async () => NextResponse.json({ success: true }))(req())
  await monitorCron("t", async () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }))(req())
  await monitorCron("t", async () => NextResponse.json({ error: "Boom" }, { status: 500 }))(req())
  await assert.rejects(monitorCron("t", async () => { throw new Error("thrown") })(req()), /thrown/)
  assert.deepEqual(writes, [
    { status: 200, error: null },
    { status: 500, error: "HTTP 500: Boom" },
    { status: 500, error: "thrown" },
  ])
  // A database error while recording never breaks the job.
  __setSqlForTests((() => Promise.reject(new Error("db down"))) as never)
  const res = await monitorCron("t", async () => NextResponse.json({ success: true }))(req())
  assert.equal(res.status, 200)
  __setSqlForTests(null)
  ok("runs recorded; refused requests skipped; recording failures ignored")

  // ---- settings checks ---------------------------------------------------------------------------
  const secret = "sk_live_DO_NOT_SHOW_123"
  const env = {
    STRIPE_SECRET_KEY: secret, STRIPE_WEBHOOK_SECRET: "whsec_hidden", STRIPE_PRICE_BASIC_MONTHLY: "p1",
    STRIPE_PRICE_BASIC_ANNUAL: "p2", STRIPE_PRICE_PREMIUM_MONTHLY: "p3", STRIPE_PRICE_PREMIUM_ANNUAL: "p4",
    RESEND_API_KEY: "re_hidden", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "vapid_pub_hidden", VAPID_PRIVATE_KEY: "priv_hidden",
    SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "KEY_hidden", TELNYX_FROM_NUMBER: "+15550000000",
    CRON_SECRET: "cron_hidden", BLOB_READ_WRITE_TOKEN: "blob_hidden", ENCRYPTION_KEY: "enc_hidden",
    GOOGLE_MAPS_API_KEY: "maps_hidden",
  }
  const checks = serviceChecks(env)
  const json = JSON.stringify(checks)
  for (const v of Object.values(env)) assert.ok(!json.includes(v), "no setting value appears")
  assert.ok(checks.every((c) => c.state === "ok"), "all set, live Stripe: all ok")
  const test = serviceChecks({ ...env, STRIPE_SECRET_KEY: "sk_test_x", ADMIN_MFA_OPTIONAL: "true" })
  assert.equal(test.find((c) => c.name.startsWith("Payments"))?.state, "warn")
  assert.equal(test.find((c) => c.name.startsWith("Admin two-step"))?.state, "warn")
  const empty = serviceChecks({})
  assert.equal(empty.find((c) => c.name === "Texts")?.detail, "Twilio: not configured")
  assert.ok(empty.filter((c) => c.name !== "Maps").every((c) => c.state === "off"))
  const maps = empty.find((c) => c.name === "Maps")!
  assert.equal(maps.state, "ok", "no Google key is normal: OpenStreetMap is the provider")
  assert.ok(maps.detail.includes("Address lookup: OpenStreetMap (Nominatim)"))
  assert.ok(checks.find((c) => c.name === "Maps")!.detail.includes("Address lookup: Google"))
  ok("settings checks report presence and Stripe mode, never values")

  console.log(`\n${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
