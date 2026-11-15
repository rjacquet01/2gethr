// Usage: npx tsx --tsconfig tsconfig.json scripts/test-parent-kid-notifications.ts
// End-to-end check of who gets which notification, on which channel, through
// the real senders (createNotification, lib/kid-notify.ts, task comments,
// family events, board posts, family alerts, the overdue-task cron), with an
// in-memory fake database (lib/db __setSqlForTests) and faked web push, Resend
// and Twilio (global fetch). No database, nothing is sent: DATABASE_URL points
// at a closed local port and every key is a placeholder.
//   1. Defaults: a notification goes out on every channel the person allows
//      (email on with no settings row; texts only with SMS on).
//   2. Anything about a child reaches every parent on every channel; never
//      the child, never the actor.
//   3. A grown-up's own activity doesn't reach the other parents.
//   4. Task comments, family events, board posts, overdue tasks, family
//      alerts and a child's event follow the same rules.
import assert from "node:assert"
import { createECDH, randomBytes } from "node:crypto"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
process.env.TWILIO_ACCOUNT_SID = "AC_test_placeholder"
process.env.TWILIO_AUTH_TOKEN = "test_placeholder"
process.env.TWILIO_PHONE_NUMBER = "+15550000000"
process.env.RESEND_API_KEY = "re_test_placeholder_never_called"
delete process.env.SMS_PROVIDER

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake database rows
type Row = Record<string, any>
type Channel = "in_app" | "push" | "email" | "sms"

const subscription = (userId: string) => {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  return JSON.stringify({
    endpoint: `https://push.example.invalid/send/${userId}`,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  })
}

async function main() {
  const vapid = await import("../lib/services/web-push-vapid")
  const keys = vapid.generateVAPIDKeys()
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey

  const { __setSqlForTests } = await import("../lib/db")
  const { createNotification, notifyTaskComment, notifyFamilyAboutEvent, checkAndNotifyOverdueTasks } = await import("../lib/notifications")
  const { notifyParentsAboutKid } = await import("../lib/kid-notify")
  const { notifyEventAssignment } = await import("../lib/assignment")
  const { notifyNewPost } = await import("../lib/board")
  const { alertFamilyAdults } = await import("../lib/family-alerts")

  // ---- the family ---------------------------------------------------------------------------------
  // mom: texts on, no settings row (email counts as on). dad: email off, no texts.
  // sam: a child with a login. aunt: a grown-up (ADULT). gus: a guest.
  const users: Record<string, Row> = {
    mom: { role: "PARENT", phone: "+16175550101", sms: true, email: true },
    dad: { role: "PARENT", phone: null, sms: false, email: false },
    sam: { role: "CHILD", phone: null, sms: false, email: true },
    aunt: { role: "ADULT", phone: null, sms: false, email: true },
    gus: { role: "GUEST", phone: null, sms: false, email: true },
  }
  const emailOf = (id: string) => `${id}@example.invalid`
  const idByEmail = (e: string) => e.split("@")[0]
  const idByPhone = (p: string) => Object.keys(users).find((id) => users[id].phone === p) ?? p
  const emailSetting = (id: string) => (id === "mom" ? null : users[id].email) // mom: NULL (no row)

  let tasks: Row[] = []
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    const u = (id: unknown) => users[id as string]
    if (q.startsWith("ALTER TYPE notification_type")) return []
    if (q.startsWith("SELECT id FROM notifications WHERE user_id")) return [] // dedupe: nothing recent
    if (q.startsWith("SELECT rs.push_enabled, rs.quiet_hours_start")) return u(v[0]) ? [{ push_enabled: true, quiet_hours_start: null, quiet_hours_end: null, timezone: "America/New_York" }] : []
    if (q.startsWith("SELECT token, platform FROM push_tokens")) return u(v[0]) ? [{ token: subscription(v[0] as string), platform: "web" }] : []
    if (q.startsWith("SELECT u.phone, rs.sms_enabled")) { const x = u(v[0]); return x ? [{ phone: x.phone, sms_enabled: x.sms }] : [] }
    if (q.startsWith("SELECT u.email, rs.email_enabled")) return u(v[0]) ? [{ email: emailOf(v[0] as string), email_enabled: emailSetting(v[0] as string) }] : []
    if (q.startsWith("SELECT id, phone, sms_consent_at FROM users")) {
      return Object.entries(users).filter(([, x]) => x.phone && String(x.phone).replace(/\D/g, "").slice(-10) === v[0])
        .map(([id, x]) => ({ id, phone: x.phone, sms_consent_at: "2026-10-01T00:00:00Z" }))
    }
    if (q.startsWith("SELECT tier, status, trial_ends_at FROM subscriptions")) return [{ tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null }]
    if (q.startsWith("INSERT INTO sms_usage")) return [{ count: 1 }]
    // lib/kid-notify.ts
    if (q.startsWith("SELECT user_id, role FROM family_members")) {
      const ids = v.find(Array.isArray) as string[]
      return ids.filter((id) => u(id)).map((id) => ({ user_id: id, role: users[id].role }))
    }
    if (q.startsWith("SELECT DISTINCT user_id FROM family_members")) {
      return Object.keys(users).filter((id) => ["PARENT", "GUARDIAN"].includes(users[id].role)).map((user_id) => ({ user_id }))
    }
    // notifyFamilyAboutEvent: non-guests minus the creator
    if (q.startsWith("SELECT fm.user_id, fm.role FROM family_members fm")) {
      return Object.keys(users).filter((id) => users[id].role !== "GUEST" && id !== v[2]).map((id) => ({ user_id: id, role: users[id].role }))
    }
    // board: non-guests minus the author
    if (q.startsWith("SELECT DISTINCT user_id, role FROM family_members")) {
      return Object.keys(users).filter((id) => users[id].role !== "GUEST" && id !== v[1]).map((id) => ({ user_id: id, role: users[id].role }))
    }
    // family alerts: parents minus the subject
    if (q.startsWith("SELECT fm.user_id, u.email, u.phone, rs.email_enabled")) {
      return Object.keys(users).filter((id) => ["PARENT", "GUARDIAN"].includes(users[id].role) && id !== v[1])
        .map((id) => ({ user_id: id, email: emailOf(id), phone: users[id].phone, email_enabled: emailSetting(id), sms_enabled: users[id].sms, push_enabled: true }))
    }
    // overdue cron
    if (q.startsWith("SELECT t.id, t.title, t.assigned_to_id, t.child_profile_id")) return tasks
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  // ---- deliveries ---------------------------------------------------------------------------------
  let got: { user: string; ch: Channel; type?: string }[] = []
  const reset = () => { got = [] }
  const realFetch = globalThis.fetch
  void realFetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const s = String(url)
    if (s.startsWith("https://push.example.invalid/send/")) {
      got.push({ user: s.split("/").pop()!, ch: "push" }); return new Response("", { status: 201 })
    }
    if (s.includes("api.resend.com")) {
      got.push({ user: idByEmail(JSON.parse(String(init?.body)).to[0]), ch: "email" })
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 })
    }
    if (s.includes("api.twilio.com")) {
      got.push({ user: idByPhone(new URLSearchParams(String(init?.body)).get("To") || ""), ch: "sms" })
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 })
    }
    throw new Error(`unexpected fetch ${s}`)
  }) as typeof fetch
  // In-app rows: every INSERT INTO notifications carries the recipient second.
  const realSql = fake
  __setSqlForTests((async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.startsWith("INSERT INTO notifications")) got.push({ user: v[1] as string, ch: "in_app", type: v[2] as string })
    return (realSql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<Row[]>)(strings, ...v)
  }) as unknown as Parameters<typeof __setSqlForTests>[0])

  const realLog = console.log, realErr = console.error, realWarn = console.warn
  const quiet = async <T,>(fn: () => Promise<T>) => {
    console.log = () => {}; console.error = () => {}; console.warn = () => {}
    try { return await fn() } finally { console.log = realLog; console.error = realErr; console.warn = realWarn }
  }
  const channelsOf = (user: string) => [...new Set(got.filter((g) => g.user === user).map((g) => g.ch))].sort()
  const reached = () => [...new Set(got.map((g) => g.user))].sort()
  const MOM_ALL = ["email", "in_app", "push", "sms"]
  const DAD_ALL = ["in_app", "push"] // dad turned email off and never opted in to texts

  // 1. defaults ------------------------------------------------------------------------------------
  reset()
  await quiet(() => createNotification({ userId: "mom", type: "SYSTEM", title: "Hello", body: "a", data: { familyId: "f1" } }))
  await quiet(() => createNotification({ userId: "dad", type: "SYSTEM", title: "Hello", body: "a", data: { familyId: "f1" } }))
  assert.deepEqual(channelsOf("mom"), MOM_ALL, "no settings row: in-app, push, email, and a text (SMS on)")
  assert.deepEqual(channelsOf("dad"), DAD_ALL, "dad's own switches: no email, no text")
  ok("defaults: every channel the person allows (email on with no settings row, texts only when opted in)")

  // 2. about a child: every parent, every channel ------------------------------------------------------
  reset()
  await quiet(() => notifyParentsAboutKid({ familyId: "f1", kid: { userIds: ["sam"] }, exclude: ["sam"], type: "TASK_COMPLETED", title: "Task Completed", body: "Sam did it" }))
  assert.deepEqual(reached(), ["dad", "mom"], "both parents, not the child")
  assert.deepEqual(channelsOf("mom"), MOM_ALL)
  assert.deepEqual(channelsOf("dad"), DAD_ALL)
  reset()
  await quiet(() => notifyParentsAboutKid({ familyId: "f1", kid: { userIds: ["mom"], childProfileId: "cp-lily" }, exclude: ["mom"], type: "TASK_ASSIGNED", title: "New task for Lily", body: "x" }))
  assert.deepEqual(reached(), ["dad"], "a child with no login (child profile) counts; the acting parent is left out")
  ok("about a child: every parent on every channel they allow; never the child or the actor")

  // 3. a grown-up's own activity reaches no one ----------------------------------------------------------
  reset()
  await quiet(() => notifyParentsAboutKid({ familyId: "f1", kid: { userIds: ["aunt", "mom"] }, exclude: ["aunt"], type: "TASK_COMPLETED", title: "Task Completed", body: "x" }))
  assert.deepEqual(reached(), [], "no child involved: no parent notice")
  ok("a grown-up's own activity: the other parents aren't told")

  // 4a. task comments -------------------------------------------------------------------------------
  reset()
  await quiet(() => notifyTaskComment({ taskId: "t1", familyId: "f1", taskTitle: "Groceries", assignedToId: "mom", commenterId: "aunt", commenterName: "Aunt", commentMessage: "got milk" }))
  assert.deepEqual(reached(), ["mom"], "grown-up's task, grown-up's comment: only the assignee")
  reset()
  await quiet(() => notifyTaskComment({ taskId: "t1", familyId: "f1", taskTitle: "Groceries", assignedToId: "mom", commenterId: "sam", commenterName: "Sam", commentMessage: "can I come" }))
  assert.deepEqual(reached(), ["dad", "mom"], "a child commented: the parents hear")
  assert.deepEqual(channelsOf("mom"), MOM_ALL)
  ok("task comments: parents only when a child is involved")

  // 4b. family events made by a grown-up ---------------------------------------------------------------
  reset()
  await quiet(() => notifyFamilyAboutEvent("f1", "Dentist", "e1", "Mom", "mom", ["in_app"], [], { participantUserIds: [], kidInvolved: false }))
  assert.deepEqual(reached(), ["sam"], "a parent's own event: the kids hear, not dad, the aunt or the guest")
  reset()
  await quiet(() => notifyFamilyAboutEvent("f1", "Dentist", "e1", "Mom", "mom", ["in_app"], [], { participantUserIds: ["aunt"], kidInvolved: false }))
  assert.deepEqual(reached(), ["aunt", "sam"], "a grown-up invited to it still hears")
  reset()
  await quiet(() => notifyFamilyAboutEvent("f1", "Sam's dentist", "e1", "Mom", "mom", ["in_app"], ["sam"], { participantUserIds: ["sam"], kidInvolved: true }))
  assert.deepEqual(reached(), ["dad"], "a child takes part: the other parent hears (the child got their own invitation)")
  assert.deepEqual(channelsOf("dad"), DAD_ALL, "on every channel, not the creator's in-app pick")
  ok("family events: kids always; other grown-ups only if invited; parents on every channel when a child takes part")

  // 4c. a child's own event: parents on every channel, whatever the child picked --------------------------
  reset()
  await quiet(() => notifyEventAssignment({ familyId: "f1", eventId: "e2", title: "Sleepover", creatorUserId: "sam", creatorName: "Sam", status: "APPROVED", participantUserIds: [], channels: ["in_app"] }))
  assert.deepEqual(reached(), ["dad", "mom"])
  assert.deepEqual(channelsOf("mom"), MOM_ALL, "the child's in-app pick doesn't limit the parents")
  ok("a child's event: parents on every channel, whatever the child picked")

  // 4d. board posts ------------------------------------------------------------------------------------
  reset()
  await quiet(() => notifyNewPost({ familyId: "f1", postId: "p1", user: { id: "mom" }, pinned: false, body: "Pizza night" }))
  assert.deepEqual(reached(), ["sam"], "a parent's post: the kids, not the other grown-ups")
  reset()
  await quiet(() => notifyNewPost({ familyId: "f1", postId: "p2", user: { id: "sam" }, pinned: false, body: "Need a ride" }))
  assert.deepEqual(reached(), ["aunt", "dad", "mom"], "a child's post: parents (and the other grown-up in-app)")
  assert.deepEqual(channelsOf("mom"), MOM_ALL, "parents on every channel")
  ok("board posts: a parent's reaches the kids; a child's reaches the parents on every channel")

  // 4e. overdue tasks --------------------------------------------------------------------------------
  reset()
  tasks = [{ id: "t9", title: "Taxes", assigned_to_id: "aunt", child_profile_id: null, family_id: "f1", child_member_id: null }]
  await quiet(() => checkAndNotifyOverdueTasks())
  assert.deepEqual(reached(), ["aunt"], "a grown-up's overdue task: only them")
  reset()
  tasks = [{ id: "t10", title: "Homework", assigned_to_id: "sam", child_profile_id: null, family_id: "f1", child_member_id: null }]
  await quiet(() => checkAndNotifyOverdueTasks())
  assert.deepEqual(reached(), ["dad", "mom", "sam"], "a child's overdue task: the child and both parents")
  assert.deepEqual(channelsOf("mom"), MOM_ALL)
  ok("overdue tasks: parents only for a child's task, on every channel")

  // 4f. family alerts (stale location, low battery...) email too ----------------------------------------
  reset()
  await quiet(() => alertFamilyAdults("f1", "sam", { title: "Sam's battery is low", body: "10%" }))
  assert.deepEqual(reached(), ["dad", "mom"])
  assert.deepEqual(channelsOf("mom"), MOM_ALL, "email and a text, not only in-app and push")
  assert.deepEqual(channelsOf("dad"), DAD_ALL)
  ok("family alerts about a child: every channel each parent allows")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
