// Usage: npx tsx --tsconfig tsconfig.json scripts/test-telnyx-sms.ts
// SMS providers: SMS_PROVIDER picks Twilio (default) or Telnyx; each sends
// the right request (URL, headers, body) and the API key never reaches a log
// or an error; the consent gate blocks both; Telnyx webhook signatures
// (Ed25519: valid, tampered, stale, wrong key); STOP / HELP through the
// Telnyx route change the database exactly as through the Twilio route.
// In-memory users / reminder_settings (lib/db __setSqlForTests) and a stubbed
// fetch: no database, nothing is sent.
import assert from "node:assert"
import { generateKeyPairSync, sign } from "node:crypto"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.TWILIO_ACCOUNT_SID = "ACtest"
process.env.TWILIO_AUTH_TOKEN = "twilio-test-token-not-real"
process.env.TWILIO_PHONE_NUMBER = "+15550000000"
const TELNYX_KEY = "KEYtelnyx-test-key-not-real-0123456789"
process.env.TELNYX_API_KEY = TELNYX_KEY
process.env.TELNYX_FROM_NUMBER = "+18662776365"
delete process.env.SMS_PROVIDER

// Every console line, to prove the API key is never logged.
const logged: string[] = []
for (const level of ["log", "warn", "error", "info", "debug"] as const) {
  const orig = console[level].bind(console)
  console[level] = (...a: unknown[]) => {
    logged.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "))
    if (level === "log") orig(...a)
  }
}

let passed = 0
const ok = (name: string) => {
  passed++
  console.log(`  ok  ${name}`)
}

type User = { id: string; phone: string; sms_consent_at: string | null }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const sms = await import("../lib/services/sms")
  const { verifyTelnyxSignature } = await import("../lib/telnyx-webhook")
  const { SMS_HELP_REPLY } = await import("../lib/sms-consent-text")
  const { SMS_START_REPLY } = await import("../lib/sms-inbound")
  const { twilioSignature } = await import("../lib/twilio-webhook")
  const telnyxRoute = await import("../app/api/webhooks/telnyx-sms/route")
  const twilioRoute = await import("../app/api/webhooks/twilio-sms/route")

  const users: User[] = [
    { id: "u-yes", phone: "(617) 555-0101", sms_consent_at: "2026-10-01T00:00:00Z" },
    { id: "u-no", phone: "6175550102", sms_consent_at: null },
    { id: "u-twilio", phone: "6175550103", sms_consent_at: "2026-10-01T00:00:00Z" },
  ]
  const settings: { user_id: unknown; sms_enabled: unknown }[] = [
    { user_id: "u-yes", sms_enabled: true },
    { user_id: "u-no", sms_enabled: true },
    { user_id: "u-twilio", sms_enabled: true },
  ]
  const sqlLog: string[] = []
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    sqlLog.push(q)
    if (q.startsWith("SELECT id, phone, sms_consent_at FROM users")) {
      return users.filter((u) => u.phone.replace(/\D/g, "").slice(-10) === v[0])
    }
    if (q.startsWith("INSERT INTO reminder_settings (id, user_id, email_enabled, push_enabled, sms_enabled")) {
      const s = settings.find((r) => r.user_id === v[1])
      if (s) s.sms_enabled = false
      else settings.push({ user_id: v[1], sms_enabled: false })
      return []
    }
    if (q.startsWith("INSERT INTO sms_usage")) return [{ count: 1 }]
    if (q.startsWith("SELECT tier, status, trial_ends_at FROM subscriptions")) return [{ tier: "PREMIUM", status: "ACTIVE" }]
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  type Call = { url: string; headers: Record<string, string>; body: string }
  const calls: Call[] = []
  let reply: () => Response = () => new Response(JSON.stringify({ data: { id: "msg-1" } }), { status: 200 })
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) })
    return reply()
  }) as typeof fetch

  // --- provider choice ---
  const pick = (v: string | undefined) => {
    if (v === undefined) delete process.env.SMS_PROVIDER
    else process.env.SMS_PROVIDER = v
    return sms.smsProvider()
  }
  assert.equal(pick(undefined), "twilio")
  assert.equal(pick("twilio"), "twilio")
  assert.equal(pick("telnyx"), "telnyx")
  assert.equal(pick(" Telnyx "), "telnyx")
  assert.equal(pick("vonage"), "twilio")
  assert.equal(pick(""), "twilio")
  delete process.env.SMS_PROVIDER
  ok("SMS_PROVIDER: unset or unknown means Twilio; 'telnyx' (any case) means Telnyx")

  // --- Twilio (default) send ---
  let r = await sms.sendSMSMetered({ to: "617.555.0101", body: "Soccer at 4", familyId: "f1" })
  assert.equal(r.success, true)
  let c = calls.pop()!
  assert.equal(c.url, "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json")
  assert.ok(c.headers["authorization"].startsWith("Basic "))
  const form = new URLSearchParams(c.body)
  assert.equal(form.get("To"), "+16175550101")
  assert.equal(form.get("From"), "+15550000000")
  assert.equal(form.get("Body"), "Togethr: Soccer at 4")
  ok("default: Twilio Messages API, E.164 number, Togethr: body")

  // --- Telnyx send ---
  process.env.SMS_PROVIDER = "telnyx"
  delete process.env.TELNYX_MESSAGING_PROFILE_ID
  r = await sms.sendSMSMetered({ to: "(617) 555-0101", body: "Soccer at 4", familyId: "f1" })
  assert.deepEqual(r, { success: true, messageId: "msg-1" })
  c = calls.pop()!
  assert.equal(c.url, "https://api.telnyx.com/v2/messages")
  assert.equal(c.headers["authorization"], `Bearer ${TELNYX_KEY}`)
  assert.equal(c.headers["content-type"], "application/json")
  assert.deepEqual(JSON.parse(c.body), { from: "+18662776365", to: "+16175550101", text: "Togethr: Soccer at 4" })
  ok("telnyx: POST /v2/messages, Bearer key, JSON {from, to (E.164), text}, no profile when unset")

  process.env.TELNYX_MESSAGING_PROFILE_ID = "profile-123"
  r = await sms.sendSMS({ to: "+16175550101", body: "Togethr: hi" })
  assert.equal(r.success, true)
  assert.equal(JSON.parse(calls.pop()!.body).messaging_profile_id, "profile-123")
  ok("telnyx: messaging_profile_id sent when set")

  reply = () => new Response(JSON.stringify({ errors: [{ code: "40310", title: "Invalid 'to' address", detail: "The 'to' number is not valid." }] }), { status: 422 })
  r = await sms.sendSMS({ to: "+16175550101", body: "hi" })
  assert.deepEqual(r, { success: false, error: "The 'to' number is not valid." })
  reply = () => new Response("Unauthorized", { status: 401 })
  r = await sms.sendSMS({ to: "+16175550101", body: "hi" })
  assert.deepEqual(r, { success: false, error: "Telnyx error 401" })
  reply = () => {
    throw new Error("connect ECONNREFUSED")
  }
  r = await sms.sendSMS({ to: "+16175550101", body: "hi" })
  assert.deepEqual(r, { success: false, error: "connect ECONNREFUSED" })
  reply = () => new Response(JSON.stringify({ data: { id: "msg-1" } }), { status: 200 })
  ok("telnyx: non-2xx and network errors are failures with the same {success, error} shape")

  // A failed metered Telnyx send gives the quota back, as with Twilio.
  reply = () => new Response("{}", { status: 500 })
  sqlLog.length = 0
  r = await sms.sendSMSMetered({ to: "+16175550101", body: "hi", familyId: "f1" })
  assert.equal(r.success, false)
  assert.ok(sqlLog.some((q) => q.startsWith("UPDATE sms_usage SET count = GREATEST(count - 1, 0)")))
  reply = () => new Response(JSON.stringify({ data: { id: "msg-1" } }), { status: 200 })
  ok("telnyx: metered, and a failed send gives its quota back")

  // --- consent gate, both providers ---
  for (const p of ["twilio", "telnyx"]) {
    process.env.SMS_PROVIDER = p
    const before = calls.length
    for (const res of [
      await sms.sendSMS({ to: "6175550102", body: "hi" }),
      await sms.sendSMSMetered({ to: "6175550102", body: "hi", familyId: "f1" }),
      await sms.sendSMSMetered({ to: "6175550102", body: "SOS", familyId: "f1", urgent: true }),
      await sms.sendSMS({ to: "+16175559999", body: "hi" }),
    ]) {
      assert.equal(res.skipped, "consent", p)
    }
    assert.equal(calls.length, before, p)
  }
  ok("consent gate blocks both providers (urgent and unmetered too): no request made")

  // Not configured: the active provider's name, nothing sent.
  delete process.env.TELNYX_API_KEY
  process.env.SMS_PROVIDER = "telnyx"
  assert.equal(sms.isSmsConfigured(), false)
  assert.deepEqual(await sms.sendSMS({ to: "+16175550101", body: "hi" }), { success: false, error: "Telnyx not configured" })
  process.env.TELNYX_API_KEY = TELNYX_KEY
  delete process.env.SMS_PROVIDER
  assert.equal(sms.isSmsConfigured(), sms.isTwilioConfigured())
  ok("isSmsConfigured follows the active provider; Twilio by default")

  // --- Telnyx webhook signature ---
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64")
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64")
  const signed = (body: string, ts: number) => sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64")
  const now = Math.floor(Date.now() / 1000)
  const body0 = JSON.stringify({ data: { event_type: "message.received" } })
  assert.equal(verifyTelnyxSignature(body0, signed(body0, now), String(now), pub), true)
  assert.equal(verifyTelnyxSignature(body0 + " ", signed(body0, now), String(now), pub), false)
  assert.equal(verifyTelnyxSignature(body0, signed(body0, now - 301), String(now - 301), pub), false)
  assert.equal(verifyTelnyxSignature(body0, signed(body0, now - 299), String(now - 299), pub), true)
  assert.equal(verifyTelnyxSignature(body0, signed(body0, now), String(now), other), false)
  assert.equal(verifyTelnyxSignature(body0, signed(body0, now), String(now + 1), pub), false)
  assert.equal(verifyTelnyxSignature(body0, null, String(now), pub), false)
  assert.equal(verifyTelnyxSignature(body0, signed(body0, now), null, pub), false)
  assert.equal(verifyTelnyxSignature(body0, "bm90LWEtc2lnbmF0dXJl", String(now), pub), false)
  assert.equal(verifyTelnyxSignature(body0, signed(body0, now), String(now), "not-a-key"), false)
  ok("signature: valid passes; tampered body, stale (>5 min), wrong key, wrong timestamp, missing or junk fail")

  // --- Telnyx route ---
  process.env.TELNYX_PUBLIC_KEY = pub
  process.env.SMS_PROVIDER = "telnyx"
  const telnyxIn = async (event: unknown, opts: { sig?: string; ts?: number } = {}) => {
    const raw = JSON.stringify(event)
    const ts = opts.ts ?? Math.floor(Date.now() / 1000)
    const req = new Request("https://mytogethr.com/api/webhooks/telnyx-sms", {
      method: "POST",
      headers: { "content-type": "application/json", "telnyx-timestamp": String(ts), "telnyx-signature-ed25519": opts.sig ?? signed(raw, ts) },
      body: raw,
    })
    const res = await telnyxRoute.POST(req as never)
    return { status: res.status, json: await res.json() }
  }
  const msg = (from: string, text: string) => ({
    data: { event_type: "message.received", payload: { from: { phone_number: from }, to: [{ phone_number: "+18662776365" }], text } },
  })

  let before = calls.length
  let res = await telnyxIn(msg("+16175550101", "STOP"), { sig: "bm90LWEtc2lnbmF0dXJl" })
  assert.equal(res.status, 403)
  res = await telnyxIn(msg("+16175550101", "STOP"), { ts: Math.floor(Date.now() / 1000) - 600 })
  assert.equal(res.status, 403)
  assert.equal(settings[0].sms_enabled, true)
  assert.equal(calls.length, before)
  ok("telnyx route: bad or stale signature refused (403), nothing changed or sent")

  res = await telnyxIn({ data: { event_type: "message.finalized", payload: { text: "STOP", from: { phone_number: "+16175550101" } } } })
  assert.equal(res.status, 200)
  assert.equal(settings[0].sms_enabled, true)
  assert.equal(calls.length, before)
  ok("telnyx route: other event types get 200 and no action")

  res = await telnyxIn(msg("+16175550101", "Stop."))
  assert.equal(res.status, 200)
  assert.equal(settings[0].sms_enabled, false)
  assert.equal(users[0].sms_consent_at, "2026-10-01T00:00:00Z")
  assert.equal(calls.length, before)
  ok("telnyx route STOP: texts off for that number, consent record kept, no reply")

  // The same STOP through the Twilio route makes the same database change.
  const twilioUrl = "https://mytogethr.com/api/webhooks/twilio-sms"
  const params = { From: "+16175550103", Body: "Stop.", MessageSid: "SM1" }
  const stopSql = (run: () => Promise<unknown>) => async () => {
    sqlLog.length = 0
    await run()
    return sqlLog.filter((q) => !q.startsWith("SELECT"))
  }
  const viaTwilio = await stopSql(() =>
    twilioRoute.POST(
      new Request(twilioUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilioSignature(process.env.TWILIO_AUTH_TOKEN!, twilioUrl, params) },
        body: new URLSearchParams(params).toString(),
      }) as never
    )
  )()
  assert.equal(settings[2].sms_enabled, false)
  settings[0].sms_enabled = true
  const viaTelnyx = await stopSql(() => telnyxIn(msg("+16175550101", "Stop.")))()
  assert.equal(settings[0].sms_enabled, false)
  assert.deepEqual(viaTelnyx, viaTwilio)
  assert.equal(viaTelnyx.length, 1)
  ok("STOP: the Telnyx route writes exactly what the Twilio route writes")

  for (const word of ["UNSUBSCRIBE", "cancel", "END", "quit", "STOPALL", "OPTOUT", "revoke"]) {
    settings[0].sms_enabled = true
    await telnyxIn(msg("+16175550101", word))
    assert.equal(settings[0].sms_enabled, false, word)
  }
  ok("telnyx route: every STOP synonym turns texts off")

  before = calls.length
  res = await telnyxIn(msg("+16175550101", "help"))
  assert.equal(res.status, 200)
  c = calls[calls.length - 1]
  assert.equal(calls.length, before + 1)
  assert.equal(c.url, "https://api.telnyx.com/v2/messages")
  assert.equal(JSON.parse(c.body).to, "+16175550101")
  assert.equal(JSON.parse(c.body).text, SMS_HELP_REPLY)
  ok("telnyx route HELP: help text sent back through Telnyx")

  settings[0].sms_enabled = false
  res = await telnyxIn(msg("+16175550101", "START"))
  assert.equal(JSON.parse(calls[calls.length - 1].body).text, SMS_START_REPLY)
  assert.equal(settings[0].sms_enabled, false)
  // HELP and START get a reply even from a number with no consent: they wrote to us.
  res = await telnyxIn(msg("+16175550102", "YES"))
  assert.equal(JSON.parse(calls[calls.length - 1].body).to, "+16175550102")
  before = calls.length
  res = await telnyxIn(msg("+16175550101", "thanks!"))
  assert.equal(res.status, 200)
  assert.equal(calls.length, before)
  ok("telnyx route START/YES: stays off, says how to turn on; other texts ignored")

  const pk = process.env.TELNYX_PUBLIC_KEY
  delete process.env.TELNYX_PUBLIC_KEY
  assert.equal((await telnyxIn(msg("+16175550101", "STOP"))).status, 503)
  process.env.TELNYX_PUBLIC_KEY = pk
  ok("telnyx route without TELNYX_PUBLIC_KEY: 503")

  // --- the key is never logged or returned ---
  assert.ok(logged.length > 0)
  assert.ok(!logged.some((l) => l.includes(TELNYX_KEY)), "Telnyx key appeared in a log line")
  assert.ok(!logged.some((l) => l.includes("twilio-test-token-not-real")), "Twilio token appeared in a log line")
  ok(`no log line (${logged.length} checked) or error contains an API key`)

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
