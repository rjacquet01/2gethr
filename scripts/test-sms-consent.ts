// Usage: npx tsx --tsconfig tsconfig.json scripts/test-sms-consent.ts
// SMS consent (Twilio 10DLC): nothing is texted to a number whose owner hasn't
// agreed, urgent alerts included; turning texts on records consent; a new
// number needs it again; the Twilio webhook (signature, STOP / START / HELP);
// "Togethr:" bodies that fit one segment. In-memory users / reminder_settings
// (lib/db __setSqlForTests) and a stubbed fetch: no database, nothing is sent.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "sms-consent-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "sms-consent-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "sms-consent-test-admin-secret-not-real-0123456789"
process.env.TWILIO_ACCOUNT_SID = "ACtest"
process.env.TWILIO_AUTH_TOKEN = "twilio-test-token-not-real"
process.env.TWILIO_PHONE_NUMBER = "+15550000000"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }
type User = { id: string; phone: string; sms_consent_at: string | null; sms_consent_text?: unknown; email: string; first_name: string; is_active: boolean }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const consent = await import("../lib/sms-consent")
  const { SMS_CONSENT_TEXT } = await import("../lib/sms-consent-text")
  const { sendSMS, sendSMSMetered, SMS_TEMPLATES } = await import("../lib/services/sms")
  const { twilioSignature, smsKeyword } = await import("../lib/twilio-webhook")
  const webhook = await import("../app/api/webhooks/twilio-sms/route")
  const settingsRoute = await import("../app/api/user/notification-settings/route")

  const users: User[] = [
    { id: "u-yes", phone: "(617) 555-0101", sms_consent_at: "2026-10-01T00:00:00Z", email: "y@example.invalid", first_name: "Y", is_active: true },
    { id: "u-no", phone: "6175550102", sms_consent_at: null, email: "n@example.invalid", first_name: "N", is_active: true },
    { id: "u-plus", phone: "+16175550103", sms_consent_at: null, email: "p@example.invalid", first_name: "P", is_active: true },
  ]
  const settings: { user_id: unknown; sms_enabled: unknown }[] = [
    { user_id: "u-yes", sms_enabled: true },
    { user_id: "u-no", sms_enabled: true }, // on from before consent was recorded
  ]
  let usage = 0
  const audit: { q: string; v: unknown[] }[] = []

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    const user = (id: unknown) => users.find((u) => u.id === id)
    if (q.startsWith("SELECT id, phone, sms_consent_at FROM users")) {
      return users.filter((u) => u.phone && u.phone.replace(/\D/g, "").slice(-10) === v[0])
    }
    if (q.startsWith("UPDATE users SET sms_consent_at = NOW()")) {
      Object.assign(user(v[1])!, { sms_consent_at: new Date().toISOString(), sms_consent_text: v[0] })
      return []
    }
    if (q.startsWith("UPDATE users SET sms_consent_at = NULL")) {
      Object.assign(user(v[0])!, { sms_consent_at: null, sms_consent_text: null })
      return []
    }
    if (q.startsWith("SELECT sms_consent_at FROM users")) return [user(v[0])].filter(Boolean)
    if (q.startsWith("SELECT phone, sms_consent_at FROM users")) return [user(v[0])].filter(Boolean)
    if (q.startsWith("SELECT phone FROM users")) return [user(v[0])].filter(Boolean)
    if (q.startsWith("INSERT INTO reminder_settings (id, user_id, email_enabled, push_enabled, sms_enabled")) {
      const s = settings.find((r) => r.user_id === v[1])
      if (s) s.sms_enabled = false
      else settings.push({ user_id: v[1], sms_enabled: false })
      return []
    }
    if (q.startsWith("SELECT * FROM reminder_settings")) return settings.filter((r) => r.user_id === v[0])
    if (q.startsWith("SELECT id FROM reminder_settings")) return settings.filter((r) => r.user_id === v[0])
    if (q.startsWith("UPDATE reminder_settings SET")) {
      const s = settings.find((r) => r.user_id === v[v.length - 1])
      if (s && v[2] != null) s.sms_enabled = v[2]
      return []
    }
    if (q.startsWith("INSERT INTO sms_usage")) { usage++; return [{ count: usage }] }
    if (q.startsWith("UPDATE sms_usage")) { usage--; return [] }
    if (q.startsWith("SELECT tier, status, trial_ends_at FROM subscriptions")) return [{ tier: "PREMIUM", status: "ACTIVE" }]
    if (q.startsWith("INSERT INTO audit_logs")) { audit.push({ q, v }); return [] }
    if (q.includes("FROM users") && q.includes("WHERE id =")) return [user(v[0])].filter(Boolean)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const sent: { To: string; Body: string }[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const p = new URLSearchParams(String(init.body))
    sent.push({ To: p.get("To")!, Body: p.get("Body")! })
    return new Response(JSON.stringify({ sid: "SMtest" }), { status: 201 })
  }) as typeof fetch

  // --- numbers and bodies ---
  assert.equal(consent.toE164("(617) 555-0101"), "+16175550101")
  assert.equal(consent.toE164("16175550101"), "+16175550101")
  assert.equal(consent.toE164("+44 20 7946 0958"), "+442079460958")
  assert.equal(consent.toE164(""), null)
  ok("phone numbers normalise to E.164")

  assert.equal(consent.formatSmsBody("Hi there"), "Togethr: Hi there")
  assert.equal(consent.formatSmsBody("Togethr: “Soccer” – today… 🎉"), 'Togethr: "Soccer" - today...')
  const long = consent.formatSmsBody("Togethr: " + "x".repeat(300))
  assert.equal(long.length, 160)
  assert.ok(long.endsWith("..."))
  assert.ok(consent.formatSmsBody("Togethr: " + "x".repeat(300), { keepWhole: true }).length > 160)
  assert.equal(consent.formatSmsBody("Togethr: José arrived"), "Togethr: José arrived")
  for (const t of [
    SMS_TEMPLATES.GEOFENCE_ARRIVAL("Maya", "School"),
    SMS_TEMPLATES.GEOFENCE_DEPARTURE("Maya", "School"),
    SMS_TEMPLATES.EVENT_REMINDER("Soccer", "4:00 PM"),
    SMS_TEMPLATES.TASK_OVERDUE("Dishes", "Sam"),
    SMS_TEMPLATES.EMERGENCY_ALERT("Sam", "Call me"),
    SMS_TEMPLATES.LOCATION_CHECK_IN("Sam", "Library"),
    SMS_TEMPLATES.VERIFICATION_CODE("123456"),
  ]) {
    assert.ok(t.startsWith("Togethr: "), t)
    assert.ok(t.length <= 160, t)
  }
  ok("bodies start with Togethr:, plain punctuation, one segment unless a safety alert")

  // --- the send gate ---
  assert.equal(await consent.hasSmsConsent("+16175550101"), true)
  assert.equal(await consent.hasSmsConsent("617-555-0102"), false)
  assert.equal(await consent.hasSmsConsent("+16175559999"), false)

  let r = await sendSMSMetered({ to: "6175550102", body: "Togethr: hi", familyId: "f1" })
  assert.equal(r.success, false)
  assert.equal(r.skipped, "consent")
  r = await sendSMSMetered({ to: "6175550102", body: "Togethr: SOS!", familyId: "f1", urgent: true })
  assert.equal(r.skipped, "consent")
  r = await sendSMS({ to: "+16175550103", body: "test" })
  assert.equal(r.skipped, "consent")
  assert.equal(sent.length, 0)
  assert.equal(usage, 0)
  ok("no consent: nothing sent (urgent and unmetered too), quota untouched")

  r = await sendSMSMetered({ to: "617.555.0101", body: "Reminder – “Soccer”", familyId: "f1" })
  assert.equal(r.success, true)
  assert.deepEqual(sent.pop(), { To: "+16175550101", Body: 'Togethr: Reminder - "Soccer"' })
  assert.equal(usage, 1)
  ok("consent on file: sent to E.164 with a Togethr: body, counted")

  // --- Settings: turning texts on is the opt-in ---
  const call = async (method: "GET" | "PATCH", userId: string, body?: unknown) => {
    const req = new Request("http://localhost/api/user/notification-settings", {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${await generateAccessToken(userId)}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    const res = await (method === "GET" ? settingsRoute.GET : settingsRoute.PATCH)(req as never)
    return { status: res.status, json: await res.json() }
  }
  let g = await call("GET", "u-no")
  assert.equal(g.json.data.smsNotifications, false)
  assert.equal(g.json.data.smsConsentNeeded, true)
  g = await call("GET", "u-yes")
  assert.equal(g.json.data.smsNotifications, true)
  assert.equal(g.json.data.smsConsentNeeded, false)
  ok("SMS on without consent shows as off, with 'confirm' needed")

  let p = await call("PATCH", "u-no", { smsNotifications: true })
  assert.equal(p.status, 400)
  assert.equal(users[1].sms_consent_at, null)
  p = await call("PATCH", "u-no", { smsNotifications: true, smsConsent: true })
  assert.equal(p.status, 200)
  assert.ok(users[1].sms_consent_at)
  assert.equal(users[1].sms_consent_text, SMS_CONSENT_TEXT)
  assert.ok(audit.some((a) => a.v.includes("sms_consent")))
  ok("turning texts on needs the consent flag; records time, wording and an audit entry")

  const off = await call("PATCH", "u-no", { smsNotifications: false })
  assert.equal(off.status, 200)
  assert.ok(users[1].sms_consent_at)
  ok("turning texts off keeps the consent record")

  // --- a new number needs consent again ---
  assert.equal(await consent.clearSmsConsentIfNumberChanges("u-yes", "+1 617 555 0101"), false)
  assert.ok(users[0].sms_consent_at)
  assert.equal(await consent.clearSmsConsentIfNumberChanges("u-yes", "6175550199"), true)
  assert.equal(users[0].sms_consent_at, null)
  users[0].sms_consent_at = "2026-10-01T00:00:00Z"
  ok("same number reformatted keeps consent; a different number clears it")

  // --- Twilio webhook ---
  // The worked example in Twilio's webhook security docs.
  assert.equal(
    twilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", {
      CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212",
    }),
    "0/KCTR6DLpKmkAf8muzZqo1nDgQ="
  )
  ok("signature matches Twilio's documented example")
  assert.equal(smsKeyword(" stop. "), "stop")
  assert.equal(smsKeyword("Unsubscribe"), "stop")
  assert.equal(smsKeyword("stop by later"), null)
  assert.equal(smsKeyword("UNSTOP"), "start")
  assert.equal(smsKeyword("revoke"), "stop")
  assert.equal(smsKeyword("OPTOUT"), "stop")
  assert.equal(smsKeyword("help"), "help")
  const URL_ = "https://mytogethr.com/api/webhooks/twilio-sms"
  const inbound = async (params: Record<string, string>, sig?: string) => {
    const req = new Request(URL_, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": sig ?? twilioSignature(process.env.TWILIO_AUTH_TOKEN!, URL_, params),
      },
      body: new URLSearchParams(params).toString(),
    })
    const res = await webhook.POST(req as never)
    return { status: res.status, text: await res.text() }
  }
  const forged = await inbound({ From: "+16175550101", Body: "STOP" }, "bm90LWEtc2lnbmF0dXJl")
  assert.equal(forged.status, 403)
  assert.equal(settings[0].sms_enabled, true)
  ok("webhook: a bad signature is refused and changes nothing")

  const stop = await inbound({ From: "+16175550101", Body: "Stop", MessageSid: "SM1" })
  assert.equal(stop.status, 200)
  assert.ok(!stop.text.includes("<Message>"))
  assert.equal(settings[0].sms_enabled, false)
  assert.ok(users[0].sms_consent_at)
  ok("webhook STOP: texts off for that number, consent record kept, no reply (Twilio confirms)")

  const start = await inbound({ From: "+16175550101", Body: "START" })
  assert.ok(start.text.includes("Settings &gt; Notifications"))
  assert.equal(settings[0].sms_enabled, false)
  const help = await inbound({ From: "+16175550101", Body: "help" })
  assert.ok(help.text.includes("<Message>Togethr: "))
  assert.ok(help.text.includes("STOP"))
  const other = await inbound({ From: "+16175550101", Body: "thanks!" })
  assert.equal(other.text, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  ok("webhook START stays off and says how to turn on; HELP replies; anything else is ignored")

  const token = process.env.TWILIO_AUTH_TOKEN
  delete process.env.TWILIO_AUTH_TOKEN
  assert.equal((await inbound({ Body: "STOP" }, "x")).status, 503)
  process.env.TWILIO_AUTH_TOKEN = token
  ok("webhook without Twilio configured: 503")

  assert.equal(sent.length, 0)
  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
