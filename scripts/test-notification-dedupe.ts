// Usage: npx tsx --tsconfig tsconfig.json scripts/test-notification-dedupe.ts
// One notification per channel, no push backlog bursts: the real
// lib/services/web-push-vapid.ts, lib/services/push.ts, lib/notifications.ts,
// lib/services/notification-dispatcher.ts and public/sw.js, on an in-memory
// fake database (lib/db __setSqlForTests) with the push service and Twilio
// faked (global fetch). Nothing touches a real database, push service or SMS:
// DATABASE_URL points at a closed local port and every key is a placeholder.
import assert from "node:assert"
import { createECDH, randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
process.env.TWILIO_ACCOUNT_SID = "AC_test_placeholder"
process.env.TWILIO_AUTH_TOKEN = "test_placeholder"
process.env.TWILIO_PHONE_NUMBER = "+15550000000"
delete process.env.RESEND_API_KEY

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake database rows
type Row = Record<string, any>

const b64url = (b: Buffer) => b.toString("base64url")
const subscription = (n: number) => {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  return JSON.stringify({
    endpoint: `https://push.example.invalid/send/device-${n}`,
    keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) },
  })
}

async function main() {
  const vapid = await import("../lib/services/web-push-vapid")
  const keys = vapid.generateVAPIDKeys()
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey

  const { __setSqlForTests } = await import("../lib/db")
  const push = await import("../lib/services/push")
  const notifications = await import("../lib/notifications")
  const dispatcher = await import("../lib/services/notification-dispatcher")

  // ---- fakes -----------------------------------------------------------------------------------
  let db!: { tokens: Row[]; notifications: Row[]; members: Row[]; users: Record<string, Row>; writes: string[] }
  const fresh = () => {
    db = { tokens: [], notifications: [], members: [], users: {}, writes: [] }
  }
  const handlers: [string, (v: unknown[], q: string) => Row[]][] = [
    // createNotification's 60-second duplicate guard
    ["SELECT id FROM notifications WHERE user_id", (v) => db.notifications
      .filter((n) => n.user_id === v[0] && n.type === v[1] && n.title === v[2] && n.body === v[3] && n.data === v[4] && Date.now() - n.at < 60_000)
      .map((n) => ({ id: n.id }))],
    ["INSERT INTO notifications", (v) => { db.notifications.push({ id: v[0], user_id: v[1], type: v[2], title: v[3], body: v[4], data: v[5], at: Date.now() }); return [] }],
    ["SELECT push_enabled FROM reminder_settings", (v) => [{ push_enabled: db.users[v[0] as string]?.push !== false }]],
    ["SELECT token, platform FROM push_tokens", (v) => db.tokens.filter((t) => t.user_id === v[0] && t.is_active)],
    ["SELECT u.phone, rs.sms_enabled", (v) => { const u = db.users[v[0] as string]; return u ? [{ phone: u.phone, sms_enabled: u.sms }] : [] }],
    ["SELECT u.email, rs.email_enabled", () => []],
    // the dispatcher's preferences
    ["SELECT email, phone FROM users WHERE id", (v) => { const u = db.users[v[0] as string]; return u ? [{ email: null, phone: u.phone }] : [] }],
    ["FROM reminder_settings WHERE user_id", (v) => { const u = db.users[v[0] as string]; return [{ email_enabled: false, sms_enabled: !!u?.sms, push_enabled: u?.push !== false }] }],
    // notifyFamilyAboutEvent's members
    ["FROM family_members fm WHERE fm.family_id", () => db.members],
    // SMS quota: a paid plan with room left
    ["SELECT tier, status, trial_ends_at FROM subscriptions", () => [{ tier: "PREMIUM", status: "ACTIVE", trial_ends_at: null }]],
    ["INSERT INTO sms_usage", () => [{ count: 1 }]],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) db.writes.push(q)
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v, q)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const pushes: { url: string; headers: Record<string, string> }[] = []
  const texts: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith("https://push.example.invalid/")) {
      pushes.push({ url: u, headers: Object.fromEntries(Object.entries(init?.headers || {})) as Record<string, string> })
      return new Response("", { status: 201 })
    }
    if (u.includes("api.twilio.com")) {
      texts.push(new URLSearchParams(String(init?.body)).get("To") || "")
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 })
    }
    throw new Error(`unexpected fetch ${u}`)
  }) as typeof fetch
  const realLog = console.log
  const realWarn = console.warn
  const quiet = async <T,>(fn: () => Promise<T>) => { console.log = () => {}; console.warn = () => {}; try { return await fn() } finally { console.log = realLog; console.warn = realWarn } }

  console.log("push headers")
  pushes.length = 0
  await vapid.sendWebPush(JSON.parse(subscription(1)), { title: "t" }, { ttl: 900, topic: "abc_DEF-123" })
  assert.equal(pushes[0].headers.TTL, "900")
  assert.equal(pushes[0].headers.Topic, "abc_DEF-123")
  await vapid.sendWebPush(JSON.parse(subscription(1)), { title: "t" }, { urgent: true })
  assert.equal(pushes[1].headers.TTL, "3600")
  assert.equal(pushes[1].headers.Urgency, "high")
  await vapid.sendWebPush(JSON.parse(subscription(1)), { title: "t" })
  assert.equal(pushes[2].headers.TTL, "900", "default is 15 minutes, not a day")
  assert.equal(vapid.pushTopic("a/b+c=d".repeat(10))!.length, 32)
  assert.match(vapid.pushTopic("a/b+c=d")!, /^[A-Za-z0-9_-]+$/)
  ok("sendWebPush: TTL 900 (3600 urgent) and a URL-safe Topic of at most 32 characters")
  assert.equal(push.pushTtlForType("EVENT_REMINDER"), 900)
  assert.equal(push.pushTtlForType("TASK_ASSIGNED"), 900)
  assert.equal(push.pushTtlForType("GEOFENCE_ALERT"), 3600)
  assert.equal(push.pushTtlForType("LOCATION_ALERT"), 3600)
  assert.equal(push.pushTtlForType("sos"), 3600)
  ok("TTL by type: reminders/events/tasks 15 min; SOS, emergency, geofence, location 1 hour")

  console.log("one push per browser")
  fresh()
  const tok = subscription(1)
  db.tokens = [{ user_id: "u1", token: tok, is_active: true }, { user_id: "u1", token: tok.replace("}", ' }'), is_active: true }]
  pushes.length = 0
  await quiet(() => push.sendPushToUser("u1", { title: "Hi", body: "x", data: { type: "TASK_ASSIGNED" } }))
  assert.equal(pushes.length, 1, "two rows for the same endpoint must push once")
  assert.equal(pushes[0].headers.TTL, "900")
  ok("sendPushToUser: two stored copies of one browser's subscription -> one push")

  fresh()
  await push.registerPushToken("u1", subscription(2), "web", { browser: "Chrome on Windows" })
  assert.ok(db.writes.some((w) => w.startsWith("UPDATE push_tokens SET is_active = false") && w.includes("device_info->>'browser'")))
  ok("registerPushToken: retires the same browser's other active tokens")

  console.log("dispatcher")
  fresh()
  db.users.u1 = { push: true, sms: false, phone: null }
  db.tokens = [{ user_id: "u1", token: subscription(3), is_active: true }]
  pushes.length = 0
  await quiet(() => dispatcher.dispatchNotification({ userId: "u1", type: "TASK_ASSIGNED", title: "New task", body: "Do it", data: { taskId: "t1" } }))
  assert.equal(pushes.length, 1, "dispatcher pushed more than once")
  assert.equal(db.notifications.length, 1)
  ok("dispatchNotification: one in-app row and ONE push (was two)")
  pushes.length = 0
  await quiet(() => dispatcher.dispatchNotification({ userId: "u1", type: "TASK_ASSIGNED", title: "Other", body: "Only in-app", channels: ["in_app"] }))
  assert.equal(pushes.length, 0, "push sent although the request left it out")
  ok("dispatchNotification: a request without push sends no push")

  console.log("60-second duplicate guard")
  fresh()
  db.users.u1 = { push: true, sms: true, phone: "+15551112222" }
  db.tokens = [{ user_id: "u1", token: subscription(4), is_active: true }]
  pushes.length = 0
  texts.length = 0
  const n = { userId: "u1", type: "TASK_ASSIGNED" as const, title: "Clean room", body: "Before dinner", data: { taskId: "t9", familyId: "f1" }, sendSms: true }
  await quiet(() => notifications.createNotification(n))
  await quiet(() => notifications.createNotification(n))
  assert.equal(db.notifications.length, 1)
  assert.equal(pushes.length, 1)
  assert.equal(texts.length, 1)
  ok("the same notification twice within a minute: one row, one push, one text")
  await quiet(() => notifications.createNotification({ ...n, data: { taskId: "t10", familyId: "f1" } }))
  assert.equal(pushes.length, 2)
  ok("a different task with the same title still goes out")
  const pushedKey = pushes[0].headers.Topic
  assert.ok(pushedKey && pushedKey.length <= 32, "push carries the dedupe key as its Topic")
  ok("the push carries the notification's dedupe key as its Topic")

  console.log("event announcements: one text per member")
  fresh()
  db.members = [{ user_id: "m1" }, { user_id: "m2" }, { user_id: "m3" }]
  db.users.m1 = { push: false, sms: true, phone: "+15550000001" }
  db.users.m2 = { push: false, sms: true, phone: "+15550000002" }
  db.users.m3 = { push: false, sms: false, phone: "+15550000003" }
  texts.length = 0
  await quiet(() => notifications.notifyFamilyAboutEvent("f1", "Game night", "e1", "Mom"))
  assert.deepEqual(texts.sort(), ["+15550000001", "+15550000002"])
  ok("no channels picked: one text each to members with SMS on, none to SMS off (was two, and everyone)")
  texts.length = 0
  await quiet(() => notifications.notifyFamilyAboutEvent("f1", "Pizza", "e2", "Mom", undefined, ["sms"]))
  assert.equal(texts.length, 2)
  ok("SMS picked: still exactly one text per member")
  texts.length = 0
  await quiet(() => notifications.notifyFamilyAboutEvent("f1", "Movie", "e3", "Mom", undefined, ["in_app"]))
  assert.equal(texts.length, 0)
  ok("SMS not picked: no texts")

  console.log("service worker")
  const shown: Row[] = []
  const listeners: Record<string, (e: Row) => void> = {}
  const store = new Map<string, string>()
  const open: Row[] = []
  const sandbox: Row = {
    self: {
      addEventListener: (type: string, fn: (e: Row) => void) => { listeners[type] = fn },
      registration: {
        showNotification: async (title: string, opts: Row) => { shown.push({ title, ...opts }); open.push({ tag: opts.tag }) },
        getNotifications: async ({ tag }: { tag: string }) => open.filter((x) => x.tag === tag),
      },
      clients: { claim() {} },
      skipWaiting() {},
      location: { origin: "https://mytogethr.com" },
    },
    caches: {
      open: async () => ({
        match: async (k: string) => (store.has(k) ? new Response(store.get(k)) : undefined),
        put: async (k: string, r: Response) => { store.set(k, await r.text()) },
        keys: async () => [...store.keys()],
        delete: async (k: string) => store.delete(k),
        addAll: async () => {},
      }),
      keys: async () => [],
    },
    clients: {},
    fetch: async () => new Response(""),
    Response, URL, console, Date, Math, Map, Promise, encodeURIComponent,
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8"), sandbox)
  const pushEvent = async (payload: Row) => {
    let p: Promise<unknown> = Promise.resolve()
    listeners.push({ data: { json: () => payload, text: () => JSON.stringify(payload) }, waitUntil: (x: Promise<unknown>) => { p = x } })
    await p
  }
  await pushEvent({ type: "TASK_ASSIGNED", title: "A", body: "x", dedupeKey: "key-1" })
  await pushEvent({ type: "TASK_ASSIGNED", title: "A", body: "x", dedupeKey: "key-1" })
  assert.equal(shown.length, 2, "the copy should replace the shown one quietly")
  assert.equal(shown[0].renotify, false)
  assert.equal(shown[0].tag, "key-1")
  assert.equal(shown[1].silent, true, "a copy must not alert again")
  ok("same tag within 2 minutes: shown once; the copy only replaces it silently (no second buzz)")
  open.length = 0
  await pushEvent({ type: "TASK_ASSIGNED", title: "A", body: "x", dedupeKey: "key-1" })
  assert.equal(shown.length, 2)
  ok("a copy after the first was dismissed: nothing shown")
  await pushEvent({ type: "TASK_ASSIGNED", title: "B", body: "y", dedupeKey: "key-2" })
  assert.equal(shown.length, 3)
  assert.equal(shown[2].silent, false)
  ok("a different notification of the same type: shown and alerts (no longer replaces the first)")

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
