// Usage: npx tsx --tsconfig tsconfig.json scripts/test-free-tier-limits.ts
// Plan caps (lib/tier-limits.ts, lib/plan-limits.ts, numbers in
// lib/subscription-tiers.ts): each cap allowed / blocked, trials on Premium's
// caps, safety pushes never counted, over-limit families keeping everything,
// and the Android-app copy with no prices or upgrade link. Runs on a small
// in-memory database (lib/db __setSqlForTests). Nothing touches a real
// database: DATABASE_URL points at a closed local port. No push is sent:
// VAPID keys are unset.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "tier-limits-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "tier-limits-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "tier-limits-test-placeholder-not-used"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"
delete process.env.VAPID_PUBLIC_KEY
delete process.env.VAPID_PRIVATE_KEY
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, unknown>

const FAMILY = "fam-1"
const OWNER = "u-owner"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const tiers = await import("../lib/subscription-tiers")
  const limits = await import("../lib/tier-limits")
  const { sendPushToUser } = await import("../lib/services/push")
  const settingsRoute = await import("../app/api/location/settings/route")

  // ---- fake database -----------------------------------------------------------------------------
  const db = {
    sub: null as Row | null,
    counts: { activeReminders: 0, boardUploads: 0, locationSharers: 0 },
    usage: new Map<string, number>(), // `${kind}` -> count this month
    settings: { mode: "OFF", share_with_family: false } as Row,
    writes: [] as string[],
    queries: [] as string[],
  }
  const reset = (sub: Row | null) => {
    db.sub = sub
    db.counts = { activeReminders: 0, boardUploads: 0, locationSharers: 0 }
    db.usage.clear()
    db.settings = { mode: "OFF", share_with_family: false }
    db.writes = []
    db.queries = []
  }
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    db.queries.push(q)
    if (/^(INSERT|UPDATE|DELETE)/.test(q) && !q.includes("plan_usage")) db.writes.push(q)
    if (q.startsWith("WITH u AS")) {
      return [{ id: v[0], email: "owner@example.invalid", first_name: "Owner", last_name: "", is_active: true,
        member_id: "m-owner", role: "PARENT", family_id: FAMILY, family_name: "Testers", owner_id: OWNER }]
    }
    if (q.includes("SELECT tier, status, trial_ends_at")) return db.sub ? [db.sub] : []
    if (q.includes("FROM reminders")) return [{ n: db.counts.activeReminders }]
    if (q.includes("FROM family_posts")) return [{ n: db.counts.boardUploads }]
    if (q.includes("FROM location_settings ls JOIN family_members fm")) return [{ n: db.counts.locationSharers }]
    if (q.startsWith("SELECT count FROM plan_usage")) {
      const n = db.usage.get(v[1] as string)
      return n === undefined ? [] : [{ count: n }]
    }
    if (q.startsWith("INSERT INTO plan_usage")) {
      // (familyId, kind, period[, limit]) - with a limit only below it.
      const kind = v[1] as string
      const cur = db.usage.get(kind) ?? 0
      const limit = v.length > 3 ? Number(v[3]) : null
      if (limit !== null && (limit <= 0 || cur >= limit)) return []
      db.usage.set(kind, cur + 1)
      return [{ count: cur + 1 }]
    }
    if (q.startsWith("UPDATE plan_usage SET count = GREATEST")) {
      const kind = v[1] as string
      db.usage.set(kind, Math.max((db.usage.get(kind) ?? 0) - 1, 0))
      return []
    }
    if (q.includes("SELECT fm.role, fm.family_id, target.user_id")) {
      return [{ role: "PARENT", family_id: FAMILY, target_user_id: OWNER, target_role: "PARENT" }]
    }
    if (q.includes("SELECT id, mode, share_with_family FROM location_settings")) return [{ id: "ls-1", ...db.settings }]
    if (q.includes("FROM push_tokens")) return [{ token: JSON.stringify({ endpoint: "https://push.invalid/1", keys: { p256dh: "x", auth: "y" } }), platform: "web" }]
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const FREE = { tier: "FREE", status: "ACTIVE", trial_ends_at: null }
  const PLUS = { tier: "PREMIUM", status: "ACTIVE", trial_ends_at: null }
  const PREMIUM = { tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null }
  const future = new Date(Date.now() + 3 * 86400_000).toISOString()
  const past = new Date(Date.now() - 86400_000).toISOString()

  // 1. The numbers asked for, from the one source of truth.
  const table: [keyof typeof tiers.SUBSCRIPTION_TIERS.FREE.limits, number, number, number][] = [
    ["maxLocationSharers", 3, 4, -1],
    ["maxActiveReminders", 5, 30, -1],
    ["maxEventsPerMonth", 15, 100, -1],
    ["maxBoardUploads", 3, 25, 100],
    ["pushMonthlyQuota", 100, 1000, -1],
    ["historyDays", 30, 90, 90],
    ["locationTrailDays", 0, 90, 90],
  ]
  for (const [field, f, p, pr] of table) {
    assert.deepStrictEqual(
      [tiers.SUBSCRIPTION_TIERS.FREE.limits[field], tiers.SUBSCRIPTION_TIERS.PREMIUM.limits[field], tiers.SUBSCRIPTION_TIERS.PREMIUM_PLUS.limits[field]],
      [f, p, pr],
      field
    )
  }
  const free = tiers.SUBSCRIPTION_TIERS.FREE.featureList
  assert.ok(free.includes("30 days of past events"))
  assert.ok(free.some((b) => b.startsWith("Live family location (3 members at once")))
  assert.ok(!free.some((b) => /trail/i.test(b)), "Free claims no location trail")
  for (const key of ["PREMIUM", "PREMIUM_PLUS"] as const) {
    assert.ok(tiers.SUBSCRIPTION_TIERS[key].featureList.includes("90-day location trail, 90 days of past events"), key)
  }
  assert.ok(tiers.SUBSCRIPTION_TIERS.FREE.featureList.some((b) => b.includes("15 new events a month")))
  ok("caps: Free / Plus / Premium numbers, and the Free plan bullets quote them")

  // 2. Each counted cap: allowed under it, blocked at it, upgrade names the next plan.
  const counted: [("activeReminders" | "boardUploads" | "locationSharers"), number, string][] = [
    ["activeReminders", 5, "Plus adds up to 30."],
    ["boardUploads", 3, "Plus adds 25 uploads."],
    ["locationSharers", 3, "Plus adds 4 at once."],
  ]
  for (const [kind, cap, more] of counted) {
    reset(FREE)
    db.counts[kind] = cap - 1
    let r = await limits.checkLimit(FAMILY, kind)
    assert.strictEqual(r.allowed, true, `${kind} under the cap`)
    db.counts[kind] = cap
    r = await limits.checkLimit(FAMILY, kind)
    assert.strictEqual(r.allowed, false, `${kind} at the cap`)
    assert.strictEqual(r.limit, cap)
    assert.strictEqual(r.upgradeTo?.key, "PREMIUM")
    assert.ok(limits.planLimitMessage(r).endsWith(more), limits.planLimitMessage(r))
  }
  ok("reminders, board uploads, location sharers: allowed under the cap, blocked at it")

  // 3. Monthly caps are claimed atomically and given back.
  reset(FREE)
  for (let i = 0; i < 15; i++) assert.strictEqual((await limits.claimMonthly(FAMILY, "eventsPerMonth")).allowed, true)
  let ev = await limits.claimMonthly(FAMILY, "eventsPerMonth")
  assert.strictEqual(ev.allowed, false, "16th event this month")
  assert.strictEqual(limits.planLimitMessage(ev), "You've used 15 of 15 events this month. Plus adds 100 a month.")
  await limits.releaseMonthly(FAMILY, "eventsPerMonth")
  assert.strictEqual((await limits.claimMonthly(FAMILY, "eventsPerMonth")).allowed, true, "a released slot can be used")
  reset(PLUS)
  db.usage.set("eventsPerMonth", 100)
  ev = await limits.claimMonthly(FAMILY, "eventsPerMonth")
  assert.strictEqual(ev.allowed, false)
  assert.strictEqual(limits.planLimitMessage(ev), "You've used 100 of 100 events this month. Premium includes unlimited events.")
  ok("events per month: 15th allowed, 16th blocked, release frees a slot; Plus stops at 100")

  // 4. Premium: unlimited caps never block; board uploads stop at 100 with no plan above.
  reset(PREMIUM)
  db.counts.activeReminders = 500
  db.counts.locationSharers = 12
  assert.strictEqual((await limits.checkLimit(FAMILY, "activeReminders")).allowed, true)
  assert.strictEqual((await limits.checkLimit(FAMILY, "locationSharers")).allowed, true)
  db.usage.set("eventsPerMonth", 5000)
  assert.strictEqual((await limits.claimMonthly(FAMILY, "eventsPerMonth")).allowed, true)
  db.counts.boardUploads = 100
  const board = await limits.checkLimit(FAMILY, "boardUploads")
  assert.strictEqual(board.allowed, false)
  assert.strictEqual(board.upgradeTo, null)
  assert.ok(limits.planLimitMessage(board).endsWith("That's the most any plan allows."))
  ok("Premium: unlimited caps never block; 100 board uploads is the top")

  // 5. Trials get Premium's caps (even a trial row stored as Plus); an ended trial is Free.
  for (const tier of ["PREMIUM_PLUS", "PREMIUM"]) {
    reset({ tier, status: "TRIALING", trial_ends_at: future })
    db.counts.activeReminders = 40
    db.counts.boardUploads = 60
    const rem = await limits.checkLimit(FAMILY, "activeReminders")
    assert.strictEqual(rem.allowed, true, `${tier} trial: reminders`)
    assert.strictEqual(rem.tier, "PREMIUM_PLUS")
    assert.strictEqual(rem.trial, true)
    assert.strictEqual((await limits.checkLimit(FAMILY, "boardUploads")).limit, 100)
  }
  reset({ tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: past })
  db.counts.activeReminders = 5
  const ended = await limits.checkLimit(FAMILY, "activeReminders")
  assert.strictEqual(ended.tier, "FREE")
  assert.strictEqual(ended.allowed, false)
  ok("trial uses Premium caps until it ends, then Free")

  // 5b. The trial ends at its end time: a minute before, Premium caps; a minute after, Free.
  const minute = 60_000
  reset({ tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: new Date(Date.now() + minute).toISOString() })
  db.counts.activeReminders = 6
  assert.strictEqual((await limits.checkLimit(FAMILY, "activeReminders")).allowed, true, "last minute of the trial")
  reset({ tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: new Date(Date.now() - minute).toISOString() })
  db.counts.activeReminders = 6
  const after = await limits.checkLimit(FAMILY, "activeReminders")
  assert.deepStrictEqual([after.tier, after.allowed, after.limit], ["FREE", false, 5], "a minute after the trial")
  ok("trial: Premium caps until trial_ends_at, Free caps from then")

  // 5c. Plus and Premium keep every limit they had before this change.
  const before = {
    PREMIUM: { maxFamilyMembers: 6, maxChildren: 5, maxSavedPlaces: 15, maxAlertPlaces: 3, maxCalendars: 5, historyDays: 90, smsMonthlyQuota: 60 },
    PREMIUM_PLUS: { maxFamilyMembers: 12, maxChildren: -1, maxSavedPlaces: 50, maxAlertPlaces: -1, maxCalendars: 20, historyDays: 90, smsMonthlyQuota: 300 },
  } as const
  for (const key of ["PREMIUM", "PREMIUM_PLUS"] as const) {
    for (const [field, value] of Object.entries(before[key])) {
      assert.strictEqual(tiers.SUBSCRIPTION_TIERS[key].limits[field as keyof typeof before.PREMIUM], value, `${key}.${field}`)
    }
    assert.ok(Object.values(tiers.SUBSCRIPTION_TIERS[key].features).filter(Boolean).length >= 7, `${key} features`)
  }
  ok("Plus and Premium: earlier limits unchanged")

  // 6. Over the cap after a downgrade: refused, and nothing is deleted or changed.
  reset(FREE)
  db.counts.activeReminders = 12
  db.counts.boardUploads = 40
  db.counts.locationSharers = 6
  for (const kind of ["activeReminders", "boardUploads", "locationSharers"] as const) {
    const r = await limits.checkLimit(FAMILY, kind)
    assert.strictEqual(r.allowed, false)
    assert.ok(r.used > (r.limit ?? 0))
  }
  assert.deepStrictEqual(db.writes, [], "checking a cap writes nothing")
  ok("over-limit family: adding is refused, existing data untouched")

  // 7. Through the real route: turning on a 3rd sharer on Free is 402 PLAN_LIMIT, nothing written;
  //    a member who already shares can still change settings while the family is over.
  const token = await generateAccessToken(OWNER)
  const patch = (body: Row, cookie?: string) =>
    new NextRequest("http://localhost/api/location/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
  reset(FREE)
  db.counts.locationSharers = 3
  let res = await settingsRoute.PATCH(patch({ memberId: "m-owner", mode: "ACTIVE", shareWithFamily: true }))
  assert.strictEqual(res.status, 402)
  const body = await res.json()
  assert.strictEqual(body.code, "PLAN_LIMIT")
  assert.deepStrictEqual({ kind: body.limit.kind, used: body.limit.used, limit: body.limit.limit, up: body.limit.upgradeTo?.name },
    { kind: "locationSharers", used: 3, limit: 3, up: "Plus" })
  assert.deepStrictEqual(db.writes, [], "a refused switch-on writes nothing")
  reset(FREE)
  db.counts.locationSharers = 5
  db.settings = { mode: "ACTIVE", share_with_family: true }
  res = await settingsRoute.PATCH(patch({ memberId: "m-owner", updateIntervalSec: 600 }))
  assert.strictEqual(res.status, 200, "already sharing: keeps working over the cap")
  assert.ok((db.writes as string[]).every((w) => !w.startsWith("DELETE")), "nothing deleted")
  ok("location settings route: 402 PLAN_LIMIT at the cap; existing sharers keep sharing")

  // 8. Inside the Android app: neutral copy, no plan to buy, no price, no upgrade link.
  reset(FREE)
  db.counts.locationSharers = 3
  res = await settingsRoute.PATCH(patch({ memberId: "m-owner", mode: "ACTIVE", shareWithFamily: true }, "togethr_android=1"))
  const appBody = await res.json()
  assert.strictEqual(res.status, 402)
  assert.ok(appBody.error.endsWith(limits.IN_APP_LIMIT_COPY), appBody.error)
  assert.strictEqual(appBody.limit.upgradeTo, null)
  for (const word of ["Plus", "Premium", "$", "upgrade", "Upgrade", "/subscription", "checkout"]) {
    assert.ok(!appBody.error.includes(word), `app copy mentions ${word}`)
  }
  const msg = limits.planLimitMessage({ kind: "eventsPerMonth", used: 15, limit: 15, trial: false, upgradeTo: { key: "PREMIUM", name: "Plus", limit: 100 } }, { inApp: true })
  assert.strictEqual(msg, `You've used 15 of 15 events this month. ${limits.IN_APP_LIMIT_COPY}`)
  assert.ok(!/https?:|\/subscription/.test(limits.IN_APP_LIMIT_COPY) && !limits.IN_APP_NEAR_LIMIT_COPY.includes("/"), "no link in app copy")
  ok("Android app copy: neutral, no prices, plan names or upgrade link")

  // 9. Push quota: routine pushes stop at the cap; safety and urgent pushes never touch it.
  const usageQueries = () => db.queries.filter((q) => q.includes("plan_usage"))
  reset(FREE)
  db.usage.set("routinePush", 100)
  let sent = await sendPushToUser(OWNER, { title: "Soccer at 5", body: "Reminder", data: { type: "EVENT_REMINDER" }, routineFamilyId: FAMILY })
  assert.deepStrictEqual(sent, { sent: 0, failed: 0 }, "routine push over quota is skipped before sending")
  reset(FREE)
  db.usage.set("routinePush", 100)
  sent = await sendPushToUser(OWNER, { title: "SOS", body: "Help", data: { type: "sos" }, urgent: true })
  assert.strictEqual(sent.failed, 1, "the SOS push was attempted (VAPID is off in tests)")
  sent = await sendPushToUser(OWNER, { title: "Arrived", body: "At school", data: { type: "LOCATION_ALERT" } })
  assert.strictEqual(sent.failed, 1, "the arrival alert was attempted")
  sent = await sendPushToUser(OWNER, { title: "Urgent", body: "x", urgent: true, routineFamilyId: FAMILY })
  assert.strictEqual(sent.failed, 1, "urgent ignores the quota")
  assert.deepStrictEqual(usageQueries(), [], "safety pushes never read or count the quota")
  reset(FREE)
  sent = await sendPushToUser(OWNER, { title: "Board", body: "New flyer", routineFamilyId: FAMILY })
  assert.strictEqual(db.usage.get("routinePush"), 0, "a routine push no device got is given back")
  ok("push quota: routine capped; SOS, arrival and urgent pushes never counted")

  // 9b. Safety senders never pass a quota family and never call the plan caps.
  const fs = await import("node:fs")
  const SAFETY_FILES = [
    "lib/sos.ts", "lib/emergency-alert.ts", "lib/location-approval.ts", "lib/family-alerts.ts",
    "app/api/location/sos/route.ts", "app/api/location/emergency-alert/route.ts", "app/api/location/access/route.ts",
    "app/api/cron/location-stale/route.ts",
  ]
  for (const f of SAFETY_FILES) {
    const src = fs.readFileSync(f, "utf8")
    assert.ok(!/routineFamilyId|tier-limits|claimMonthly|checkLimit/.test(src), `${f} touches the plan caps`)
  }
  const geofence = fs.readFileSync("app/api/location/route.ts", "utf8")
  const geoFn = geofence.slice(geofence.indexOf("createGeofenceNotification"))
  assert.ok(!/routineFamilyId/.test(geoFn.slice(0, 4000)), "arrival/departure push is not routine")
  ok("SOS, emergency, geofence, location and approval senders never touch the caps")

  // 10. Which notification types count.
  for (const t of ["EVENT_REMINDER", "REMINDER", "TASK_ASSIGNED", "TASK_COMMENT", "EVENT_CREATED", "APPROVAL_RESPONSE"]) {
    assert.strictEqual(limits.isRoutinePush(t, {}), true, t)
  }
  assert.strictEqual(limits.isRoutinePush("SYSTEM", { subType: "BOARD_POST" }), true)
  for (const t of ["LOCATION_ALERT", "GEOFENCE_ALERT", "EVENT_APPROVAL_REQUEST", "APPROVAL_REQUEST", "FAMILY_INVITATION", "SUBSCRIPTION_ALERT"]) {
    assert.strictEqual(limits.isRoutinePush(t, {}), false, t)
  }
  assert.strictEqual(limits.isRoutinePush("SYSTEM", { subType: "LEGAL_NOTICE" }), false)
  ok("routine vs safety notification types")

  // 11. The soft nudge from 80%.
  assert.strictEqual(limits.isNearLimit({ used: 11, limit: 15 }), false)
  assert.strictEqual(limits.isNearLimit({ used: 12, limit: 15 }), true)
  assert.strictEqual(limits.isNearLimit({ used: 4, limit: 5 }), true)
  assert.strictEqual(limits.isNearLimit({ used: 99, limit: null }), false)
  ok("near-limit nudge at 80%")

  __setSqlForTests(null)
  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
