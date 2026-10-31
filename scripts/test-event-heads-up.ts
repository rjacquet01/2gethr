// Usage: npx tsx --tsconfig tsconfig.json scripts/test-event-heads-up.ts
// The "Upcoming Event" heads-up: once, the day before, by in-app, push and
// email (never text), and nothing earlier. The real lib/notifications.ts on an
// in-memory fake database (lib/db __setSqlForTests); push and email not
// configured, so nothing is sent; their preference look-ups show which
// channels were attempted.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
process.env.RESEND_API_KEY = "re_test_placeholder_never_called"
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
delete process.env.VAPID_PRIVATE_KEY

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { headsUpBody, headsUpChannels, HEADS_UP_TIMED_HOURS, HEADS_UP_ALL_DAY_HOURS } = await import("../lib/event-heads-up")
  const { __setSqlForTests } = await import("../lib/db")
  const { checkAndNotifyUpcomingDueDates } = await import("../lib/notifications")

  // --- pure helpers ---
  assert.deepEqual(headsUpChannels(null), ["in_app", "push", "email"])
  assert.deepEqual(headsUpChannels(["in_app", "push", "email", "sms"]), ["in_app", "push", "email"], "never text")
  assert.deepEqual(headsUpChannels(["sms"]), [], "text only: no heads-up")
  assert.deepEqual(headsUpChannels(["push"]), ["push"])
  ok("channels: the event's picks, without text")

  const start = new Date("2026-11-01T20:30:00Z") // 3:30 PM in New York (EST)
  assert.equal(headsUpBody({ title: "Soccer", start, allDay: false, location: "Field 2", timeZone: "America/New_York" }), '"Soccer" is tomorrow at 3:30 PM at Field 2')
  assert.equal(headsUpBody({ title: "Soccer", start, allDay: false, timeZone: "America/Los_Angeles" }), '"Soccer" is tomorrow at 12:30 PM', "each person's own time zone")
  assert.equal(headsUpBody({ title: "Halloween", start, allDay: true }), '"Halloween" is tomorrow (all day)')
  assert.equal(headsUpBody({ title: "X", start, allDay: false, timeZone: "Not/AZone" }), '"X" is tomorrow at 3:30 PM', "a bad zone falls back to New York")
  ok("text: tomorrow at the time in the person's zone, or all day")

  assert.deepEqual([HEADS_UP_TIMED_HOURS.from, HEADS_UP_TIMED_HOURS.to], [22, 24])
  assert.ok(HEADS_UP_ALL_DAY_HOURS.to <= 6, "all-day: the evening before, not days ahead")

  // --- the hourly job ---
  const queries: { q: string; v: unknown[] }[] = []
  let events: Record<string, unknown>[] = []
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    queries.push({ q, v })
    if (q.startsWith("SELECT e.id, e.title, e.start_time, e.location, e.is_all_day, e.notify_channels")) return events
    if (q.startsWith("SELECT fm.user_id, u.timezone FROM family_members fm")) return [{ user_id: "ray", timezone: "America/New_York" }, { user_id: "mom", timezone: "America/Chicago" }]
    if (q.startsWith("SELECT u.email, rs.email_enabled")) return [{ email: `${v[0]}@example.invalid`, email_enabled: true }]
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)
  const sentMail: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) { sentMail.push(JSON.parse(String(init?.body)).subject); return new Response(JSON.stringify({ id: "e1" }), { status: 200 }) }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
  const realLog = console.log
  const quiet = async <T,>(fn: () => Promise<T>) => { console.log = () => {}; try { return await fn() } finally { console.log = realLog } }

  events = [{ id: "ev1", title: "Dinner", start_time: new Date(Date.now() + 23 * 3600_000).toISOString(), location: null, is_all_day: false, notify_channels: ["in_app", "push", "email", "sms"], created_by_id: "ray", visibility: "FAMILY", family_id: "f1" }]
  const r = await quiet(() => checkAndNotifyUpcomingDueDates())
  assert.equal(r.eventsNotified, 2)

  const sel = queries.find((x) => x.q.startsWith("SELECT e.id, e.title, e.start_time, e.location, e.is_all_day"))!
  assert.ok(!sel.q.includes("48 hours"), "no 2-day notice any more")
  assert.deepEqual(sel.v.slice(0, 4), [22, 24, 4, 6], "22-24 h ahead (timed), 4-6 h before midnight (all-day)")
  assert.ok(sel.q.includes("'headsUp'"), "sent once per event")

  const inserts = queries.filter((x) => x.q.startsWith("INSERT INTO notifications"))
  assert.equal(inserts.length, 2, "in-app for both")
  assert.ok(String(inserts[0].v[4]).startsWith('"Dinner" is tomorrow at '), "says tomorrow at the time")
  assert.ok(!queries.some((x) => x.q.startsWith("SELECT u.phone, rs.sms_enabled")), "never texted")
  assert.equal(sentMail.length, 2, "emailed")
  ok("job: day-before window only, in-app + email (+ push), no text, once per event")

  queries.length = 0; sentMail.length = 0
  events = [{ ...events[0], notify_channels: ["sms"] }]
  await quiet(() => checkAndNotifyUpcomingDueDates())
  assert.ok(!queries.some((x) => x.q.startsWith("INSERT INTO notifications")), "text-only event: no heads-up")
  ok("an event set to text only gets no heads-up (its reminders still text)")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
