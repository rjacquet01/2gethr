// Usage: npx tsx --tsconfig tsconfig.json scripts/test-notification-fixes.ts
// Notification fixes from the Oct 30 audit, on the real code with an
// in-memory fake database (lib/db __setSqlForTests) and faked push / Twilio /
// Telnyx (global fetch). No database, nothing is sent: DATABASE_URL points at
// a closed local port and every key is a placeholder.
//   1. Task comments: TASK_COMMENT is added to the notification_type enum
//      (it was missing, so every task-comment notification failed).
//   2. Quiet hours hold back routine pushes (not approval requests).
//   3. A parent's approval request ignores the child's channel picks.
//   4. A send refused because the number replied STOP (Twilio 21610, Telnyx
//      40300) turns texts off in the app.
//   5. Family event reminders skip guests.
//   6. Approving a repeating "Ask a parent" event decides the whole series.
import assert from "node:assert"
import { createECDH, randomBytes } from "node:crypto"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
process.env.JWT_ACCESS_SECRET = "notification-fixes-test-access-secret-not-real-0123"
process.env.JWT_REFRESH_SECRET = "notification-fixes-test-refresh-secret-not-real-0123"
process.env.TWILIO_ACCOUNT_SID = "AC_test_placeholder"
process.env.TWILIO_AUTH_TOKEN = "test_placeholder"
process.env.TWILIO_PHONE_NUMBER = "+15550000000"
process.env.CRON_SECRET = "cron-test-secret"
delete process.env.RESEND_API_KEY
delete process.env.SMS_PROVIDER

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake database rows
type Row = Record<string, any>

const subscription = (n: number) => {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  return JSON.stringify({
    endpoint: `https://push.example.invalid/send/device-${n}`,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  })
}

/** "HH:MM" in New York, `deltaMin` from now. */
const nyTime = (deltaMin: number) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(Date.now() + deltaMin * 60_000))

async function main() {
  const vapid = await import("../lib/services/web-push-vapid")
  const keys = vapid.generateVAPIDKeys()
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey

  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { createNotification } = await import("../lib/notifications")
  const { notifyEventAssignment } = await import("../lib/assignment")
  const { sendSMS } = await import("../lib/services/sms")
  const cron = await import("../app/api/cron/event-reminders/route")
  const approve = await import("../app/api/events/[eventId]/approve/route")

  // ---- fake database -----------------------------------------------------------------------------
  let db!: {
    queries: { q: string; v: unknown[] }[]
    users: Record<string, Row>
    members: Row[]
    events: Row[]
    seriesIds: string[]
  }
  const fresh = () => { db = { queries: [], users: {}, members: [], events: [], seriesIds: [] } }
  fresh()
  const tokens = new Map<string, string>()
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    db.queries.push({ q, v })
    const u = (id: unknown) => db.users[id as string]
    if (q.startsWith("ALTER TYPE notification_type")) return []
    if (q.startsWith("SELECT id FROM notifications WHERE user_id")) return []
    if (q.startsWith("SELECT rs.push_enabled, rs.quiet_hours_start")) {
      const x = u(v[0]); return x ? [{ push_enabled: true, quiet_hours_start: x.quietStart ?? null, quiet_hours_end: x.quietEnd ?? null, timezone: "America/New_York" }] : []
    }
    if (q.startsWith("SELECT token, platform FROM push_tokens")) return tokens.has(v[0] as string) ? [{ token: tokens.get(v[0] as string), platform: "web" }] : []
    if (q.startsWith("SELECT u.phone, rs.sms_enabled")) { const x = u(v[0]); return x ? [{ phone: x.phone, sms_enabled: x.sms }] : [] }
    if (q.startsWith("SELECT id, phone, sms_consent_at FROM users")) {
      return Object.entries(db.users).filter(([, x]) => x.phone && String(x.phone).replace(/\D/g, "").slice(-10) === v[0])
        .map(([id, x]) => ({ id, phone: x.phone, sms_consent_at: "2026-10-01T00:00:00Z" }))
    }
    if (q.startsWith("INSERT INTO reminder_settings")) { const x = u(v[1]); if (x) x.sms = false; return [] }
    if (q.startsWith("SELECT tier, status, trial_ends_at FROM subscriptions")) return [{ tier: "PREMIUM", status: "ACTIVE", trial_ends_at: null }]
    if (q.startsWith("SELECT tier FROM subscriptions")) return [{ tier: "PREMIUM" }]
    if (q.startsWith("INSERT INTO sms_usage")) return [{ count: 1 }]
    if (q.startsWith("SELECT DISTINCT user_id FROM family_members")) return db.members.filter((m) => ["PARENT", "GUARDIAN"].includes(m.role) && m.user_id !== v[1]).map((m) => ({ user_id: m.user_id }))
    // event-reminders
    if (q.startsWith("SELECT e.id, e.title, e.start_time, e.reminder_minutes")) return db.events
    if (q.startsWith("SELECT DISTINCT u.id, u.email, u.phone, u.timezone FROM users u JOIN family_members fm")) {
      // Postgres semantics of the family half: guests drop out only if the query says so.
      const skipGuests = q.includes("fm.role <> 'GUEST'")
      return db.members.filter((m) => !(skipGuests && m.role === "GUEST")).map((m) => ({ id: m.user_id, email: null, phone: null, timezone: "America/New_York" }))
    }
    if (q.startsWith("SELECT push_enabled, email_enabled, sms_enabled, quiet_hours_start")) return [{ push_enabled: false, email_enabled: false, sms_enabled: false }]
    if (q.startsWith("INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at) SELECT")) return [{ id: "n" }]
    // approve route
    if (q.startsWith("WITH u AS")) { const x = u(v[0]); return x ? [{ id: v[0], email: "p@example.invalid", first_name: "P", is_active: true, family_id: "f1", family_name: "F", owner_id: v[0], role: "PARENT", member_id: "m-p" }] : [] }
    if (q.startsWith("SELECT e.id, e.title, e.status, e.created_by_id, e.recurrence_rule_id")) return db.events.filter((e) => e.id === v[1]).map((e) => ({ ...e, role: "PARENT", family_id: "f1" }))
    if (q.startsWith("UPDATE events SET status")) return db.seriesIds.map((id) => ({ id }))
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const pushes: string[] = []
  const texts: { to: string; via: string }[] = []
  let smsReply: { status: number; body: Row } = { status: 201, body: { sid: "SM1" } }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const s = String(url)
    if (s.startsWith("https://push.example.invalid/")) { pushes.push(s); return new Response("", { status: 201 }) }
    if (s.includes("api.twilio.com")) {
      texts.push({ to: new URLSearchParams(String(init?.body)).get("To") || "", via: "twilio" })
      return new Response(JSON.stringify(smsReply.body), { status: smsReply.status })
    }
    if (s.includes("api.telnyx.com")) {
      texts.push({ to: JSON.parse(String(init?.body)).to, via: "telnyx" })
      return new Response(JSON.stringify(smsReply.body), { status: smsReply.status })
    }
    throw new Error(`unexpected fetch ${s}`)
  }) as typeof fetch
  const realLog = console.log, realErr = console.error, realWarn = console.warn
  const quiet = async <T,>(fn: () => Promise<T>) => {
    console.log = () => {}; console.error = () => {}; console.warn = () => {}
    try { return await fn() } finally { console.log = realLog; console.error = realErr; console.warn = realWarn }
  }

  // 1. TASK_COMMENT --------------------------------------------------------------------------------
  db.users.u1 = { phone: null, sms: false }
  await quiet(() => createNotification({ userId: "u1", type: "TASK_COMMENT", title: "New comment", body: "x", data: { taskId: "t1", familyId: "f1" } }))
  const alterAt = db.queries.findIndex((x) => x.q === "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TASK_COMMENT'")
  const insertAt = db.queries.findIndex((x) => x.q.startsWith("INSERT INTO notifications"))
  assert.ok(alterAt >= 0, "TASK_COMMENT is added to the enum")
  assert.ok(insertAt > alterAt, "before the notification is written")
  const before = db.queries.length
  await quiet(() => createNotification({ userId: "u1", type: "TASK_COMMENT", title: "Another", body: "y", data: { taskId: "t1", familyId: "f1" } }))
  assert.ok(!db.queries.slice(before).some((x) => x.q.startsWith("ALTER TYPE")), "only once per server instance")
  ok("task comments: TASK_COMMENT added to the enum before the first one, once")

  // 2. quiet hours ---------------------------------------------------------------------------------
  fresh()
  tokens.set("u2", subscription(2))
  db.users.u2 = { phone: null, sms: false, quietStart: nyTime(-60), quietEnd: nyTime(60) }
  pushes.length = 0
  await quiet(() => createNotification({ userId: "u2", type: "TASK_ASSIGNED", title: "Upcoming task", body: "a", data: { taskId: "t2", familyId: "f1" } }))
  assert.equal(pushes.length, 0, "routine push held back in quiet hours")
  assert.ok(db.queries.some((x) => x.q.startsWith("INSERT INTO notifications")), "the in-app notification is still written")
  await quiet(() => createNotification({ userId: "u2", type: "APPROVAL_REQUEST", title: "Needs approval", body: "b", data: { taskId: "t2", familyId: "f1" } }))
  assert.equal(pushes.length, 1, "an approval request still pushes in quiet hours")
  db.users.u2.quietStart = nyTime(60); db.users.u2.quietEnd = nyTime(120)
  await quiet(() => createNotification({ userId: "u2", type: "TASK_ASSIGNED", title: "Upcoming task 2", body: "c", data: { taskId: "t3", familyId: "f1" } }))
  assert.equal(pushes.length, 2, "outside quiet hours the routine push goes out")
  ok("quiet hours: routine pushes held back (in-app kept); approval requests and other hours unaffected")

  // 3. approval requests ignore the child's channel picks -------------------------------------------
  fresh()
  db.users.parent = { phone: "+16175550111", sms: true }
  db.members = [{ user_id: "parent", role: "PARENT" }, { user_id: "kid", role: "CHILD" }]
  texts.length = 0
  await quiet(() => notifyEventAssignment({
    familyId: "f1", eventId: "e1", title: "Sleepover", creatorUserId: "kid", creatorName: "Kid",
    status: "PENDING", participantUserIds: [], channels: ["in_app"],
  }))
  assert.equal(texts.length, 1, "the parent is texted although the child picked in-app only")
  assert.ok(db.queries.some((x) => x.q.startsWith("INSERT INTO notifications") && x.v[2] === "EVENT_APPROVAL_REQUEST"))
  ok("approval request: parents get it on their own settings (text included), not the child's picks")

  // 4. a send refused because the number replied STOP ----------------------------------------------
  fresh()
  db.users.texty = { phone: "+16175550122", sms: true }
  smsReply = { status: 400, body: { code: 21610, message: "Attempt to send to unsubscribed recipient +16175550122" } }
  let r = await quiet(() => sendSMS({ to: "+16175550122", body: "Togethr: hi" }))
  assert.equal(r.success, false)
  assert.equal(r.skipped, "consent", "treated like no consent (SOS retry loops stop)")
  assert.equal(db.users.texty.sms, false, "texts turned off in the app (Twilio 21610)")
  db.users.texty.sms = true
  process.env.SMS_PROVIDER = "telnyx"
  process.env.TELNYX_API_KEY = "telnyx-test-key"
  process.env.TELNYX_FROM_NUMBER = "+15550000009"
  smsReply = { status: 403, body: { errors: [{ code: "40300", title: "Blocked due to STOP message" }] } }
  r = await quiet(() => sendSMS({ to: "+16175550122", body: "Togethr: hi" }))
  assert.equal(r.skipped, "consent")
  assert.equal(db.users.texty.sms, false, "texts turned off in the app (Telnyx 40300)")
  delete process.env.SMS_PROVIDER
  smsReply = { status: 400, body: { code: 21211, message: "The 'To' number +16175550199 is not a valid phone number." } }
  const logged: string[] = []
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")) }
  db.users.texty.sms = true
  r = await sendSMS({ to: "+16175550122", body: "Togethr: hi" })
  console.error = realErr
  assert.equal(r.skipped, undefined, "other errors are not an opt-out")
  assert.equal(db.users.texty.sms, true)
  assert.ok(logged.length > 0 && !logged.join(" ").includes("6175550199"), "the number in Twilio's message isn't logged")
  smsReply = { status: 201, body: { sid: "SM1" } }
  ok("STOP seen on send (Twilio 21610 / Telnyx 40300): texts off in the app; other errors untouched, no number logged")

  // 5. family event reminders skip guests -----------------------------------------------------------
  fresh()
  db.members = [{ user_id: "parent", role: "PARENT" }, { user_id: "kid", role: "CHILD" }, { user_id: "guest", role: "GUEST" }]
  db.events = [{ id: "ev1", title: "Dinner", start_time: new Date(Date.now() + 10 * 60_000).toISOString(), reminder_minutes: [15], location: null, visibility: "FAMILY", created_by_id: "parent", notify_channels: ["in_app"], family_id: "f1" }]
  const res = await quiet(() => cron.GET(new Request("http://localhost/api/cron/event-reminders", { headers: { Authorization: "Bearer cron-test-secret" } }) as never))
  assert.equal(res.status, 200)
  const reminded = db.queries.filter((x) => x.q.startsWith("INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at) SELECT")).map((x) => x.v[1])
  assert.deepEqual(reminded.sort(), ["kid", "parent"], "the guest isn't reminded")
  ok("family event reminders: everyone but guests")

  // 6. repeating "Ask a parent" event: one decision for the series ----------------------------------
  fresh()
  db.users.parent = { phone: null, sms: false }
  db.events = [{ id: "e1", title: "Piano", status: "PENDING", created_by_id: "kid", recurrence_rule_id: "r1" }]
  db.seriesIds = ["e1", "e2", "e3"]
  const token = await generateAccessToken("parent")
  const call = () => approve.POST(new Request("http://localhost/api/events/e1/approve", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "APPROVE" }),
  }) as never, { params: Promise.resolve({ eventId: "e1" }) })
  let resp = await quiet(call)
  assert.equal(resp.status, 200)
  const upd = db.queries.find((x) => x.q.startsWith("UPDATE events SET status"))!
  assert.ok(upd.q.includes("recurrence_rule_id = ?") && upd.q.includes("status = 'PENDING'"), "the whole pending series")
  const reqs = db.queries.find((x) => x.q.startsWith("UPDATE event_requests"))!
  assert.deepEqual(reqs.v.find(Array.isArray), ["e1", "e2", "e3"], "every occurrence's request is answered")
  db.seriesIds = []
  db.queries.length = 0
  resp = await quiet(call)
  assert.equal(resp.status, 409, "already decided by another parent")
  assert.ok(!db.queries.some((x) => x.q.startsWith("INSERT INTO notifications")), "and nobody is notified twice")
  ok("repeating approval: decides every pending occurrence; a second decision is refused")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
