// Usage: npx tsx --tsconfig tsconfig.json scripts/test-smart-import.ts
// Smart Import (lib/smart-import*.ts, POST/GET /api/import/events): the
// output parser (valid, missing year, no time, garbage, empty), caps, the
// prompt, the monthly count with roll back, the review-screen helpers, and
// the route with the AI call replaced. No database (in-memory fake), no
// Blob storage (fake), and never the real AI API: smartImportAi.extract is
// swapped out and any other network call throws.
import assert from "node:assert"

process.env.TZ = "America/New_York"
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "smart-import-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "smart-import-test-refresh-secret-not-real-0123456789"
delete process.env.ANTHROPIC_API_KEY
delete process.env.SMART_IMPORT_MODEL

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake rows
type Row = Record<string, any>

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const PARENT = "11111111-1111-4111-8111-111111111111"
const CHILD = "22222222-2222-4222-8222-222222222222"
const GUEST = "33333333-3333-4333-8333-333333333333"
const STRANGER = "44444444-4444-4444-8444-444444444444"
const GUARDIAN = "55555555-5555-4555-8555-555555555555"
const ADULT = "66666666-6666-4666-8666-666666666666"
const FAM = "fam-1"

async function main() {
  const lib = await import("../lib/smart-import")
  const { parseImportOutput, smartImportCap, smartImportUpgrade, importSystemPrompt, todayIn, IMPORT_OUTPUT_SCHEMA } = lib
  const { SMART_IMPORTS_PER_MONTH } = await import("../lib/subscription-tiers")
  const { reviewEventTimes, findDuplicate } = await import("../lib/smart-import-review")

  // ---- parser -------------------------------------------------------------------
  const TODAY = "2026-11-05"
  function ev(o: Row = {}): Row {
    return {
      title: "Soccer practice", date: "2026-11-10", startTime: "17:30", endTime: "19:00", allDay: false,
      location: "Field 2", notes: "Bring water", confidence: "high", sourceText: "Practice Tue Nov 10 5:30-7pm", recurrence: null, ...o,
    }
  }
  {
    const [e] = parseImportOutput({ events: [ev()] }, TODAY)
    assert.deepStrictEqual(e, {
      title: "Soccer practice", date: "2026-11-10", startTime: "17:30", endTime: "19:00", allDay: false,
      location: "Field 2", notes: "Bring water", confidence: "high", sourceText: "Practice Tue Nov 10 5:30-7pm", recurrence: null,
    })
  }
  ok("valid event passes through unchanged")

  {
    // Missing year: the model picks the next occurrence and says "med"; kept as given.
    const [e] = parseImportOutput({ events: [ev({ date: "2027-01-15", confidence: "med" })] }, TODAY)
    assert.equal(e.date, "2027-01-15")
    assert.equal(e.confidence, "med")
    // A date already past is marked low (unticked by default), never moved.
    const [past] = parseImportOutput({ events: [ev({ date: "2026-10-01", confidence: "high" })] }, TODAY)
    assert.equal(past.date, "2026-10-01")
    assert.equal(past.confidence, "low")
  }
  ok("missing year: next occurrence kept with its confidence; a past date is marked low")

  {
    const [a] = parseImportOutput({ events: [ev({ startTime: null, endTime: null, allDay: false })] }, TODAY)
    assert.equal(a.allDay, true)
    assert.equal(a.startTime, null)
    assert.equal(a.endTime, null)
    const [b] = parseImportOutput({ events: [ev({ startTime: "5:30pm", endTime: "19:00", confidence: "high" })] }, TODAY)
    assert.equal(b.allDay, true, "unreadable time dropped, not guessed")
    assert.equal(b.startTime, null)
    assert.equal(b.endTime, null)
    assert.equal(b.confidence, "med")
    const [c] = parseImportOutput({ events: [ev({ endTime: "17:00" })] }, TODAY)
    assert.equal(c.endTime, null, "end before start dropped")
    const [d] = parseImportOutput({ events: [ev({ startTime: null, endTime: "19:00", allDay: true })] }, TODAY)
    assert.equal(d.endTime, null, "end without a start dropped")
  }
  ok("no time: all-day; a time that isn't HH:MM is dropped and confidence lowered; bad end times dropped")

  {
    for (const raw of [null, undefined, "nope", 42, [], {}, { events: "x" }, { events: null }]) {
      assert.deepStrictEqual(parseImportOutput(raw, TODAY), [], `garbage ${JSON.stringify(raw)}`)
    }
    const kept = parseImportOutput({
      events: [
        ev({ title: "" }),
        ev({ title: null }),
        ev({ date: "2026-02-30" }),
        ev({ date: "next Tuesday" }),
        ev({ date: 20261110 }),
        "a string",
        null,
        ev({ title: "  Picture   day  ", confidence: "certain", location: "  ", notes: "" }),
      ],
    }, TODAY)
    assert.equal(kept.length, 1)
    assert.equal(kept[0].title, "Picture day")
    assert.equal(kept[0].confidence, "low", "unknown confidence becomes low")
    assert.equal(kept[0].location, null)
    assert.equal(kept[0].notes, null)
    assert.deepStrictEqual(parseImportOutput({ events: [] }, TODAY), [])
  }
  ok("garbage and empty: no title / not a real date / wrong types dropped; nothing invented")

  {
    const dupes = parseImportOutput({ events: [ev(), ev({ title: "SOCCER PRACTICE" }), ev({ date: "2026-11-17" })] }, TODAY)
    assert.equal(dupes.length, 2, "same title, date and time listed once")
    const many = parseImportOutput({ events: Array.from({ length: 40 }, (_, i) => ev({ title: `Game ${i}` })) }, TODAY)
    assert.equal(many.length, lib.SMART_IMPORT_MAX_EVENTS)
    const long = parseImportOutput({ events: [ev({ title: "x".repeat(500), sourceText: "y".repeat(999) })] }, TODAY)
    assert.equal(long[0].title.length, 200, "title fits createEventSchema")
    assert.equal(long[0].sourceText.length, 300)
  }
  ok("duplicates merged, at most 25 events, lengths capped to what /api/events accepts")

  // ---- caps, prompt, schema -----------------------------------------------------------
  assert.deepStrictEqual(SMART_IMPORTS_PER_MONTH, { FREE: 3, PLUS: 20, PREMIUM: 60, TRIAL: 10 })
  assert.equal(smartImportCap("FREE", false), 3)
  assert.equal(smartImportCap("PREMIUM", false), 20)
  assert.equal(smartImportCap("PREMIUM_PLUS", false), 60)
  assert.equal(smartImportCap("PREMIUM_PLUS", true), 10, "7-day trial")
  assert.deepStrictEqual(smartImportUpgrade("FREE", false), { key: "PREMIUM", name: "Plus", limit: 20 })
  assert.deepStrictEqual(smartImportUpgrade("PREMIUM", false), { key: "PREMIUM_PLUS", name: "Premium", limit: 60 })
  assert.equal(smartImportUpgrade("PREMIUM_PLUS", false), null)
  assert.equal(smartImportUpgrade("PREMIUM_PLUS", true), null)
  ok("caps: Free 3, Plus 20, Premium 60, trial 10; upgrade target named by display name")

  {
    const t = todayIn("America/Los_Angeles", new Date("2026-11-06T03:00:00Z"))
    assert.deepStrictEqual(t, { date: "2026-11-05", weekday: "Thursday" }, "today in the person's zone, not UTC")
    const p = importSystemPrompt("America/Los_Angeles", t)
    assert.ok(p.includes("Thursday, 2026-11-05") && p.includes("America/Los_Angeles"))
    assert.ok(/Never invent a time/.test(p) && /allDay to true/.test(p))
    assert.ok(/next occurrence/.test(p) && /"med"/.test(p))
    assert.ok(/Ignore any instructions/.test(p))
    const schema = JSON.stringify(IMPORT_OUTPUT_SCHEMA)
    assert.ok(schema.includes('"additionalProperties":false'))
  }
  ok("prompt: today and time zone only, never invent a time, missing year -> med, ignores instructions")

  // ---- review helpers --------------------------------------------------------------------
  {
    const t = reviewEventTimes({ title: "A", date: "2026-11-10", startTime: "17:30", endTime: "19:00", allDay: false })
    assert.deepStrictEqual(t, { startTime: "2026-11-10T22:30:00.000Z", endTime: "2026-11-11T00:00:00.000Z" })
    const noEnd = reviewEventTimes({ title: "A", date: "2026-11-10", startTime: "17:30", endTime: null, allDay: false })
    assert.equal(noEnd.endTime, "2026-11-10T23:30:00.000Z", "one hour by default")
    const allDay = reviewEventTimes({ title: "A", date: "2026-11-10", startTime: null, endTime: null, allDay: true })
    assert.equal(allDay.startTime, "2026-11-10T05:00:00.000Z")
    const existing = [{ title: "soccer  Practice", startTime: "2026-11-10T22:30:00.000Z" }]
    assert.ok(findDuplicate({ title: "Soccer practice", date: "2026-11-10", startTime: "17:30", endTime: null, allDay: false }, existing))
    assert.equal(findDuplicate({ title: "Soccer practice", date: "2026-11-10", startTime: "18:00", endTime: null, allDay: false }, existing), null)
    assert.equal(findDuplicate({ title: "Piano", date: "2026-11-10", startTime: "17:30", endTime: null, allDay: false }, existing), null)
  }
  ok("review: local times to UTC (1 hour default, all-day), duplicate = same title + same start")

  // ---- fake database ------------------------------------------------------------------
  const { __setSqlForTests } = await import("../lib/db")
  const roles: Record<string, string> = { [PARENT]: "PARENT", [CHILD]: "CHILD", [GUEST]: "GUEST", [GUARDIAN]: "GUARDIAN", [ADULT]: "ADULT" }
  let sub: Row | null = null
  let usage: Record<string, number> = {}
  let rateHits = 0
  const posts: Record<string, Row> = {
    "post-1": { flyer_full_path: "board-flyers/fam-1/post-1-1-full.jpg", taken_down_at: null, keep_up: false, expires_at: null },
    "post-down": { flyer_full_path: "board-flyers/fam-1/post-down-1-full.jpg", taken_down_at: "2026-11-01", keep_up: false, expires_at: null },
  }
  const handlers: [string, (v: unknown[]) => Row[]][] = [
    ["FROM users WHERE id = ? AND is_active = true", (v) => [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "T", last_name: "", timezone: "America/Chicago", is_active: true }]],
    ["SELECT fm.role, (f.owner_id = ?) AS is_owner", (v) => (roles[v[0] as string] && v[1] === FAM ? [{ role: roles[v[0] as string], is_owner: v[0] === PARENT }] : [])],
    ["SELECT tier, status, trial_ends_at FROM subscriptions", () => (sub && ["ACTIVE", "TRIALING"].includes(sub.status) ? [sub] : [])],
    ["SELECT tier, status, trial_ends_at, stripe_subscription_id, trial_source", () => (sub ? [sub] : [])],
    ["SELECT count FROM plan_usage", (v) => (usage[`${v[0]}|${v[1]}`] !== undefined ? [{ count: usage[`${v[0]}|${v[1]}`] }] : [])],
    ["INSERT INTO plan_usage", (v) => {
      const [fam, kind, , limit] = v as [string, string, string, number]
      const k = `${fam}|${kind}`
      if (usage[k] === undefined) {
        if (limit <= 0) return []
        usage[k] = 1
        return [{ count: 1 }]
      }
      if (usage[k] >= limit) return []
      usage[k]++
      return [{ count: usage[k] }]
    }],
    ["UPDATE plan_usage SET count = GREATEST", (v) => {
      const k = `${v[0]}|${v[1]}`
      if (usage[k] !== undefined) usage[k] = Math.max(usage[k] - 1, 0)
      return []
    }],
    ["INSERT INTO rate_limit_hits", () => [{ n: rateHits++, oldest: new Date().toISOString() }]],
    ["FROM family_posts", (v) => (v[1] === FAM && posts[v[0] as string] ? [posts[v[0] as string]] : [])],
    ["SELECT u.timezone FROM families f", () => [{ timezone: "America/New_York" }]],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)
  globalThis.fetch = (async (url: string | URL) => { throw new Error(`unexpected network call: ${url}`) }) as typeof fetch

  const reset = (s: Row | null = null) => { sub = s; usage = {}; rateHits = 0 }

  // ---- quota ---------------------------------------------------------------------------------
  const quota = await import("../lib/smart-import-quota")
  {
    reset()
    for (let i = 1; i <= 3; i++) assert.deepStrictEqual(await quota.claimSmartImport(FAM), { allowed: true, used: i, limit: 3, upgradeTo: { key: "PREMIUM", name: "Plus", limit: 20 } })
    const fourth = await quota.claimSmartImport(FAM)
    assert.equal(fourth.allowed, false)
    assert.equal(fourth.used, 3)
    await quota.releaseSmartImport(FAM)
    assert.equal((await quota.smartImportUsage(FAM)).used, 2, "rolled back")
    assert.equal((await quota.claimSmartImport(FAM)).allowed, true)
    await quota.releaseSmartImport(FAM)
    await quota.releaseSmartImport(FAM)
    await quota.releaseSmartImport(FAM)
    await quota.releaseSmartImport(FAM)
    assert.equal((await quota.smartImportUsage(FAM)).used, 0, "never below zero")

    reset({ tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: new Date(Date.now() + 3 * 86400000).toISOString(), stripe_subscription_id: null, trial_source: null })
    assert.equal((await quota.smartImportUsage(FAM)).limit, 10, "7-day trial")
    reset({ tier: "PREMIUM", status: "TRIALING", trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(), stripe_subscription_id: null, trial_source: "ADMIN_EXTENDED" })
    assert.equal((await quota.smartImportUsage(FAM)).limit, 20, "extended Plus trial gets Plus's cap")
    reset({ tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null, stripe_subscription_id: "sub_x", trial_source: null })
    assert.equal((await quota.smartImportUsage(FAM)).limit, 60)
  }
  ok("quota: atomic claim up to the cap, roll back, never below zero; trial 10, extended trial its plan, Premium 60")

  // ---- route ------------------------------------------------------------------------------------
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const route = await import("../app/api/import/events/route")
  const { smartImportAi } = await import("../lib/smart-import-ai")
  const { flyerStore } = await import("../lib/board-flyers")
  const sharp = (await import("sharp")).default

  const tokens: Record<string, string> = {}
  for (const u of [PARENT, CHILD, GUEST, STRANGER, GUARDIAN, ADULT]) tokens[u] = await generateAccessToken(u)
  const realExtract = smartImportAi.extract
  const aiCalls: Row[] = []
  let aiReply: () => Promise<unknown> = async () => ({ events: [ev()] })
  smartImportAi.extract = async (input) => { aiCalls.push(input); return aiReply() }
  const blobGets: string[] = []
  const flyerJpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ffffff" } }).jpeg().toBuffer()
  ;(flyerStore as Row).get = async (pathname: string) => {
    blobGets.push(pathname)
    return { statusCode: 200, stream: new Blob([new Uint8Array(flyerJpeg)]).stream(), blob: { contentType: "image/jpeg" } }
  }

  const realError = console.error
  const realInfo = console.info
  const logs: string[] = []
  const capture = async <T,>(fn: () => Promise<T>) => {
    console.error = (...a: unknown[]) => { logs.push(a.join(" ")) }
    console.info = (...a: unknown[]) => { logs.push(a.join(" ")) }
    try { return await fn() } finally { console.error = realError; console.info = realInfo }
  }
  const post = (user: string, body: Row) =>
    capture(() => route.POST(new NextRequest("http://localhost:3000/api/import/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[user]}` },
      body: JSON.stringify(body),
    })))
  const get = (user: string, familyId = FAM) =>
    route.GET(new NextRequest(`http://localhost:3000/api/import/events?familyId=${familyId}`, { headers: { authorization: `Bearer ${tokens[user]}` } }))

  // Flag off: 404 everywhere, nothing called.
  delete process.env.SMART_IMPORT_ENABLED
  reset()
  for (const v of [undefined, "1", "TRUE", "yes"]) {
    if (v === undefined) delete process.env.SMART_IMPORT_ENABLED
    else process.env.SMART_IMPORT_ENABLED = v
    assert.equal((await get(PARENT)).status, 404)
    assert.equal((await post(PARENT, { familyId: FAM, text: "Party Saturday" })).status, 404)
  }
  assert.equal(aiCalls.length, 0)
  assert.deepStrictEqual(usage, {})
  ok("flag off (unset or not exactly \"true\"): GET and POST 404, no AI call, nothing counted")

  process.env.SMART_IMPORT_ENABLED = "true"
  {
    reset()
    const g = await get(PARENT)
    assert.equal(g.status, 200)
    assert.deepStrictEqual((await g.json()).data, { enabled: true, used: 0, limit: 3, upgradeTo: { key: "PREMIUM", name: "Plus", limit: 20 } })
    assert.equal((await get(GUARDIAN)).status, 200)
    assert.equal((await get(ADULT)).status, 200)
    for (const u of [CHILD, GUEST, STRANGER]) {
      assert.equal((await get(u)).status, 403, `GET ${u}`)
      assert.equal((await post(u, { familyId: FAM, text: "Party Saturday" })).status, 403, `POST ${u}`)
    }
    assert.equal(aiCalls.length, 0)
    assert.deepStrictEqual(usage, {})
  }
  ok("flag on: adults (parent, guardian, adult) see their count; children, guests and non-members get 403, nothing sent or counted")

  {
    reset()
    aiCalls.length = 0
    logs.length = 0
    const text = "Soccer practice Tuesday Nov 10, 5:30-7pm at Field 2. Bring water."
    const res = await post(GUARDIAN, { familyId: FAM, text, timeZone: "America/Denver" })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.data.events.length, 1)
    assert.equal(body.data.events[0].title, "Soccer practice")
    assert.equal(body.data.used, 1)
    assert.deepStrictEqual(Object.keys(aiCalls[0]).sort(), ["image", "text", "timeZone", "today"])
    assert.equal(aiCalls[0].text, text)
    assert.equal(aiCalls[0].image, undefined)
    assert.equal(aiCalls[0].timeZone, "America/Denver")
    assert.match(aiCalls[0].today.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(!logs.join("\n").includes("Soccer"), "content never logged")
    assert.ok(logs.some((l) => l.includes("[smart-import] text: 1 event(s)")))
    // Bad time zone falls back to the person's own.
    await post(PARENT, { familyId: FAM, text, timeZone: "Mars/Olympus" })
    assert.equal(aiCalls[1].timeZone, "America/Chicago")
  }
  ok("text: a guardian can import; only the text, time zone and date go to the AI; counted once; content not logged")

  {
    reset()
    aiCalls.length = 0
    blobGets.length = 0
    const res = await post(PARENT, { familyId: FAM, postId: "post-1" })
    assert.equal(res.status, 200)
    assert.deepStrictEqual(blobGets, ["board-flyers/fam-1/post-1-1-full.jpg"])
    assert.ok(Buffer.isBuffer(aiCalls[0].image) && aiCalls[0].image.length === flyerJpeg.length)
    assert.equal(aiCalls[0].text, undefined)
    assert.equal((await post(PARENT, { familyId: FAM, postId: "post-down" })).status, 404, "taken-down flyer")
    assert.equal((await post(PARENT, { familyId: FAM, postId: "post-other" })).status, 404)
    assert.equal(usage[`${FAM}|smartImport`], 1, "a missing flyer isn't counted")
  }
  ok("board flyer: the stored full image is read server-side; taken-down or other-family posts 404, not counted")

  {
    reset()
    aiCalls.length = 0
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#ff0000" } }).png().toBuffer()
    const form = new FormData()
    form.append("familyId", FAM)
    form.append("file", new File([new Uint8Array(png)], "flyer.png", { type: "image/png" }))
    const res = await capture(() => route.POST(new NextRequest("http://localhost:3000/api/import/events", {
      method: "POST", headers: { authorization: `Bearer ${tokens[PARENT]}` }, body: form,
    })))
    assert.equal(res.status, 200)
    const meta = await sharp(aiCalls[0].image).metadata()
    assert.equal(meta.format, "jpeg", "re-encoded (EXIF stripped) before sending")
    const bad = new FormData()
    bad.append("familyId", FAM)
    bad.append("file", new File([new Uint8Array(Buffer.from("not an image"))], "x.png", { type: "image/png" }))
    const badRes = await capture(() => route.POST(new NextRequest("http://localhost:3000/api/import/events", {
      method: "POST", headers: { authorization: `Bearer ${tokens[PARENT]}` }, body: bad,
    })))
    assert.equal(badRes.status, 400)
    assert.equal(aiCalls.length, 1)
  }
  ok("photo upload: checked like a flyer and re-encoded to JPEG before it is sent; a fake image is refused")

  {
    reset()
    aiCalls.length = 0
    assert.equal((await post(PARENT, { familyId: FAM })).status, 400)
    assert.equal((await post(PARENT, { familyId: FAM, text: "   " })).status, 400)
    assert.equal((await post(PARENT, { familyId: FAM, text: "x".repeat(8001) })).status, 400)
    assert.equal((await post(PARENT, { text: "Party" })).status, 400)
    assert.equal(aiCalls.length, 0)
    assert.deepStrictEqual(usage, {})
  }
  ok("bad input: 400 before anything is counted or sent")

  {
    reset()
    aiCalls.length = 0
    logs.length = 0
    aiReply = async () => { throw new Error("overloaded: secret content Soccer") }
    const res = await post(PARENT, { familyId: FAM, text: "Soccer Tuesday" })
    assert.equal(res.status, 503)
    assert.equal((await res.json()).error, "Import isn't available right now. Try again in a minute.")
    assert.equal(usage[`${FAM}|smartImport`], 0, "count rolled back")
    assert.ok(!logs.join("\n").includes("secret content"), "error text from the provider isn't logged")
    aiReply = async () => ({ events: [] })
    const none = await post(PARENT, { familyId: FAM, text: "Hello there" })
    assert.equal(none.status, 200)
    const nb = await none.json()
    assert.deepStrictEqual(nb.data.events, [])
    assert.equal(nb.data.message, "We couldn't find any dates in this. You can add the event yourself.")
    aiReply = async () => "not json at all"
    const junk = await post(PARENT, { familyId: FAM, text: "Hello there" })
    assert.deepStrictEqual((await junk.json()).data.events, [], "garbage reply: nothing found, nothing guessed")
    aiReply = async () => ({ events: [ev()] })
  }
  ok("AI failure: 503 with the friendly message and the count rolled back; nothing found: friendly message")

  {
    reset()
    for (let i = 0; i < 3; i++) assert.equal((await post(PARENT, { familyId: FAM, text: "Party Saturday" })).status, 200)
    aiCalls.length = 0
    const res = await post(PARENT, { familyId: FAM, text: "Party Saturday" })
    assert.equal(res.status, 402)
    const body = await res.json()
    assert.equal(body.error, "You've used your imports this month.")
    assert.equal(body.code, "PLAN_LIMIT")
    assert.deepStrictEqual(body.limit, { kind: "smartImport", used: 3, limit: 3, upgradeTo: { key: "PREMIUM", name: "Plus", limit: 20 } })
    assert.equal(aiCalls.length, 0, "no AI call over the cap")
    const inApp = await capture(() => route.POST(new NextRequest("http://localhost:3000/api/import/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[PARENT]}`, cookie: "togethr_android=1" },
      body: JSON.stringify({ familyId: FAM, text: "Party" }),
    })))
    assert.equal((await inApp.json()).limit.upgradeTo, null, "no upgrade offer inside the Android app")
  }
  ok("over the monthly cap: 402 \"You've used your imports this month.\", no AI call; no upgrade offer in the app")

  {
    reset({ tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null, stripe_subscription_id: "sub_x", trial_source: null })
    let status = 0
    for (let i = 0; i < 11; i++) status = (await post(PARENT, { familyId: FAM, text: "Party Saturday" })).status
    assert.equal(status, 429, "11th call in an hour")
    assert.equal(usage[`${FAM}|smartImport`], 10, "the refused call isn't counted")
  }
  ok("rate limit: 10 an hour per person, the 11th refused before counting")

  {
    // The route never writes events: no INSERT INTO events in any path above.
    const src = (await import("node:fs")).readFileSync("app/api/import/events/route.ts", "utf8")
    assert.ok(!/INSERT INTO events|\/api\/events/.test(src.replace(/\/\/.*$/gm, "")))
  }
  ok("the import route never writes to the calendar")

  {
    // The real request, captured by a fake fetch: never reaches the API.
    const sent: Row[] = []
    let reply: Row = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ events: [ev()] }) }] }
    const savedFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url)
      if (!u.startsWith("https://api.anthropic.com/")) throw new Error(`unexpected network call: ${u}`)
      sent.push({ url: u, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({
        id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5",
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, ...reply,
      }), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch
    const today = { date: "2026-11-05", weekday: "Thursday" }
    await assert.rejects(realExtract({ text: "x", timeZone: "UTC", today }), /ANTHROPIC_API_KEY/, "no key: fails, so the route rolls back")
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real"
    const out = await realExtract({ image: flyerJpeg, timeZone: "America/New_York", today })
    assert.deepStrictEqual(out, { events: [ev()] })
    const { body } = sent[0]
    assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages")
    assert.equal(body.model, "claude-haiku-5-5", "default: a small vision model")
    assert.deepStrictEqual(body.output_config, { effort: "medium", format: { type: "json_schema", schema: JSON.parse(JSON.stringify(IMPORT_OUTPUT_SCHEMA)) } })
    assert.equal(body.messages.length, 1)
    assert.deepStrictEqual(body.messages[0].content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: flyerJpeg.toString("base64") } })
    assert.ok(body.system.includes("Thursday, 2026-11-05") && body.system.includes("America/New_York"))
    assert.ok(!("thinking" in body) && !("temperature" in body))
    process.env.SMART_IMPORT_MODEL = "claude-sonnet-5-5"
    await realExtract({ text: "Party Saturday 3pm", timeZone: "UTC", today })
    assert.equal(sent[1].body.model, "claude-sonnet-5-5", "SMART_IMPORT_MODEL overrides")
    assert.ok(sent[1].body.messages[0].content[0].text.includes("<text>\nParty Saturday 3pm\n</text>"))
    reply = { stop_reason: "max_tokens", content: [{ type: "text", text: "{\"events\": [" }] }
    await assert.rejects(realExtract({ text: "x", timeZone: "UTC", today }), /stop_reason max_tokens/)
    reply = { stop_reason: "refusal", content: [] }
    await assert.rejects(realExtract({ text: "x", timeZone: "UTC", today }), /stop_reason refusal/)
    delete process.env.SMART_IMPORT_MODEL
    delete process.env.ANTHROPIC_API_KEY
    globalThis.fetch = savedFetch
  }
  ok("AI request: Haiku by default (SMART_IMPORT_MODEL overrides), strict JSON schema, only the image or text; cut-off or refused replies fail")

  __setSqlForTests(null)
  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
