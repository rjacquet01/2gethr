// Usage: npx tsx --tsconfig tsconfig.json scripts/test-account-change-emails.ts
// Admin emails on account changes (lib/admin-account-alerts.ts): the subject
// and body, that secrets never appear, that a no-op sends nothing, and that
// representative routes (profile update, account deletion, admin plan change)
// send one. Nothing touches a real database, Stripe or email: DATABASE_URL
// points at a closed local port, sql is an in-memory fake, notifyAdmin is
// replaced by a recorder, and any network call throws.

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_never_called"
process.env.JWT_ACCESS_SECRET = "account-emails-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "account-emails-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "account-emails-test-admin-secret-not-real-0123456789"
delete process.env.RESEND_API_KEY

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake rows
type Row = Record<string, any>

const results: { name: string; pass: boolean; note?: string }[] = []
const check = (name: string, pass: boolean, note?: string) => {
  results.push({ name, pass, note })
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${!pass && note ? `\n        ${note}` : ""}`)
}

const USER = "u-owner"
const USER_EMAIL = "owner@example.invalid"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const { NextRequest } = await import("next/server")
  const alerts = await import("../lib/admin-account-alerts")
  const profile = await import("../app/api/auth/profile/route")
  const accountDelete = await import("../app/api/account/delete/route")
  const adminSub = await import("../app/api/admin/subscriptions/[subscriptionId]/route")

  const sent: { subject: string; html: string; text: string }[] = []
  alerts.accountAlertDeps.notifyAdmin = async (subject: string, html: string, text?: string) => {
    sent.push({ subject, html, text: text ?? "" })
  }
  globalThis.fetch = (async (url: string | URL) => { throw new Error(`unexpected network call: ${url}`) }) as typeof fetch

  // ---- fake database ------------------------------------------------------------
  let me: Row = {}
  let sub: Row = {}
  const reset = () => {
    sent.length = 0
    me = { id: USER, email: USER_EMAIL, first_name: "Ana", last_name: "Rivera", phone: "+15551234567", timezone: "America/New_York", date_of_birth: null, is_active: true }
    sub = { id: "sub-1", family_id: "fam-1", tier: "PREMIUM", status: "ACTIVE", stripe_subscription_id: null, cancel_at_period_end: false }
  }
  reset()
  const handlers: [string, (v: unknown[]) => Row[]][] = [
    // Copies, so a route's "before" row doesn't follow a later UPDATE.
    ["SELECT first_name, last_name, phone, timezone, date_of_birth FROM users WHERE id", () => [{ ...me }]],
    ["UPDATE users SET first_name = COALESCE", (v) => {
      if (v[0] != null) me.first_name = v[0]
      if (v[1] != null) me.last_name = v[1]
      return []
    }],
    ["FROM users WHERE id =", () => [{ ...me }]],
    ["FROM admin_users", (v) => (v[0] === "admin-super" ? [{ id: v[0], email: "ops@example.invalid", status: "ACTIVE", mfa_enabled: true }] : [])],
    ["FROM admin_roles r", (v) => (v[0] === "admin-super" ? [{ name: "SUPER_ADMIN" }] : [])],
    ["SELECT DISTINCT p.key", () => []],
    ["SELECT * FROM subscriptions WHERE id", () => [{ ...sub }]],
    ["UPDATE subscriptions SET tier = ?, updated_at = NOW()", (v) => { sub.tier = v[0]; return [] }],
    ["SELECT u.email, f.name FROM families f JOIN users u", () => [{ email: USER_EMAIL, name: "Rivera Family" }]],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const realError = console.error
  const realWarn = console.warn
  const quiet = async <T,>(fn: () => Promise<T>) => {
    console.error = () => {}
    console.warn = () => {}
    try { return await fn() } finally { console.error = realError; console.warn = realWarn }
  }
  const userToken = await generateAccessToken(USER)
  const adminToken = await generateAdminAccessToken({ id: "admin-super", email: "ops@example.invalid", firstName: "O", lastName: "Ps", status: "ACTIVE", mfaEnabled: true, roles: ["SUPER_ADMIN"], permissions: [] } as Parameters<typeof generateAdminAccessToken>[0])
  const req = (method: string, path: string, token: string, body: Row) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      body: JSON.stringify(body),
    })

  // ===== helper ===================================================================
  console.log("Helper: subject and body")
  {
    const email = alerts.accountChangeEmail({
      actor: "ops@example.invalid",
      actorType: "admin",
      accountEmail: USER_EMAIL,
      familyName: "<b>Rivera</b> Family",
      change: "Plan changed by admin",
      details: { plan: { from: "Plus", to: "Premium" } },
      ipAddress: "203.0.113.7",
    })
    check("subject is [Togethr] Account change: <change> - <accountEmail>", email.subject === `[Togethr] Account change: Plan changed by admin - ${USER_EMAIL}`, email.subject)
    check("body names account, change, actor, family, IP and the change", [USER_EMAIL, "Plan changed by admin", "ops@example.invalid (admin portal)", "203.0.113.7", "plan: Plus -&gt; Premium"].every((s) => email.html.includes(s)), email.html)
    check("text body has the same facts", ["Account: owner@example.invalid", "Made by: ops@example.invalid (admin portal)", "plan: Plus -> Premium"].every((s) => email.text.includes(s)), email.text)
    check("names are HTML-escaped", email.html.includes("&lt;b&gt;Rivera&lt;/b&gt;") && !email.html.includes("<b>Rivera</b>"))
  }

  console.log("Helper: sensitive values never in the email")
  {
    const secrets = ["Hunter2-Secret!", "$2b$10$abcdefghijklmnopqrstuv", "JBSWY3DPEHPK3PXP", "4242424242424242", "tok_live_abc123", "BACKUP-1234", "2014-05-06"]
    const email = alerts.accountChangeEmail({
      actor: USER_EMAIL,
      actorType: "user",
      accountEmail: USER_EMAIL,
      change: "Security settings changed",
      details: {
        password: { from: secrets[0], to: "Other-Secret1" },
        passwordHash: secrets[1],
        totpSecret: secrets[2],
        mfaSecret: secrets[2],
        cardNumber: secrets[3],
        refreshToken: secrets[4],
        backupCodes: secrets[5],
        dateOfBirth: { from: null, to: secrets[6] },
        email: { from: "ana.rivera@example.invalid", to: "new.address@example.invalid" },
        phone: { from: "+15551234567", to: "+15559876543" },
        firstName: { from: "Ana", to: "Anita" },
      },
    })
    const all = `${email.subject}\n${email.html}\n${email.text}`
    const leaked = [...secrets, "Other-Secret1", "ana.rivera@", "new.address@", "5551234567", "5559876543"].filter((s) => all.includes(s))
    check("no password, hash, MFA secret, card, token, backup code or birthdate", leaked.length === 0, `leaked: ${leaked.join(", ")}`)
    check("secret fields say only 'changed'", ["password: changed", "passwordHash: changed", "totpSecret: changed", "cardNumber: changed", "dateOfBirth: changed"].every((s) => email.text.includes(s)), email.text)
    check("email and phone are masked old -> new", email.text.includes("email: a***@example.invalid -> n***@example.invalid") && email.text.includes("phone: ***4567 -> ***6543"), email.text)
    check("non-sensitive fields show old -> new", email.text.includes("firstName: Ana -> Anita"))
  }

  console.log("Helper: no-op skip and never throws")
  {
    reset()
    const same = alerts.changedFields({ firstName: "Ana", phone: "+1555", timezone: "UTC" }, { firstName: "Ana", phone: "+1555", timezone: undefined })
    check("changedFields is empty when nothing changed (undefined = not submitted)", Object.keys(same).length === 0, JSON.stringify(same))
    check("changedFields treats '' and null alike", Object.keys(alerts.changedFields({ nickname: null }, { nickname: "" })).length === 0)
    await alerts.notifyAccountChange({ actor: "a", actorType: "user", accountEmail: "a", change: "x", details: same })
    check("empty details: nothing sent", sent.length === 0)
    await alerts.notifyAccountChange({ actor: "a", actorType: "user", accountEmail: "a", change: "Password changed" })
    check("no details given: sent", sent.length === 1)
    const saved = alerts.accountAlertDeps.notifyAdmin
    alerts.accountAlertDeps.notifyAdmin = async () => { throw new Error("mail down") }
    let threw = false
    try { await quiet(() => alerts.notifyAccountChange({ actor: "a", actorType: "user", accountEmail: "a", change: "x" })) } catch { threw = true }
    alerts.accountAlertDeps.notifyAdmin = saved
    check("a failing send never throws to the route", !threw)
  }

  // ===== routes ===================================================================
  console.log("Route: PATCH /api/auth/profile")
  {
    reset()
    const res = await quiet(() => profile.PATCH(req("PATCH", "/api/auth/profile", userToken, { firstName: "Anita", lastName: "Rivera" })))
    check("profile update: 200", res.status === 200, `status ${res.status}`)
    check("profile update: one email", sent.length === 1, `${sent.length} sent`)
    check("profile update: subject and the changed name", sent[0]?.subject === `[Togethr] Account change: Profile updated - ${USER_EMAIL}` && sent[0]?.text.includes("firstName: Ana -> Anita"), sent[0]?.text)
    check("profile update: unchanged fields not listed", !!sent[0] && !sent[0].text.includes("lastName"), sent[0]?.text)
    check("profile update: IP is the first forwarded hop", !!sent[0]?.text.includes("IP address: 203.0.113.7"), sent[0]?.text)

    reset()
    const same = await quiet(() => profile.PATCH(req("PATCH", "/api/auth/profile", userToken, { firstName: "Ana", lastName: "Rivera", timezone: "America/New_York" })))
    check("profile saved with no change: 200 and no email", same.status === 200 && sent.length === 0, `status ${same.status}, ${sent.length} sent`)
  }

  console.log("Route: POST /api/account/delete")
  {
    // The route ends with clearAuthCookies(), and next/headers cookies() only
    // works inside a real Next.js request: here that last step fails after the
    // account is closed and the email is sent. Any other error is a failure.
    reset()
    const errors: string[] = []
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")) }
    const res = await accountDelete.POST(req("POST", "/api/account/delete", userToken, { confirmEmail: USER_EMAIL }))
    console.error = realError
    const onlyCookies = errors.length > 0 && errors.every((e) => /cookies/.test(e))
    check("account deletion: runs to the cookie step (200 in a real request)", res.status === 200 || onlyCookies, errors.join(" | "))
    check("account deletion: one 'Account deleted' email", sent.length === 1 && sent[0].subject === `[Togethr] Account change: Account deleted - ${USER_EMAIL}`, sent.map((s) => s.subject).join(" | "))

    reset()
    const wrong = await quiet(() => accountDelete.POST(req("POST", "/api/account/delete", userToken, { confirmEmail: "someone@else.invalid" })))
    check("refused deletion: no email", wrong.status === 400 && sent.length === 0, `status ${wrong.status}, ${sent.length} sent`)
  }

  console.log("Route: PATCH /api/admin/subscriptions/[id] change_tier")
  {
    reset()
    const call = (body: Row) => quiet(() => adminSub.PATCH(req("PATCH", "/api/admin/subscriptions/sub-1", adminToken, body), { params: Promise.resolve({ subscriptionId: "sub-1" }) }))
    const res = await call({ action: "change_tier", tier: "PREMIUM_PLUS", reason: "Support goodwill" })
    check("admin tier change: 200", res.status === 200, `status ${res.status}`)
    check("admin tier change: one email to the owner account", sent.length === 1 && sent[0].subject === `[Togethr] Account change: Plan changed by admin - ${USER_EMAIL}`, sent.map((s) => s.subject).join(" | "))
    check("admin tier change: display names, admin actor, reason", !!sent[0] && ["plan: Plus -> Premium", "ops@example.invalid (admin portal)", "reason: Support goodwill", "Family: Rivera Family"].every((s) => sent[0].text.includes(s)), sent[0]?.text)

    sent.length = 0
    await call({ action: "change_tier", tier: "PREMIUM_PLUS" })
    check("admin tier change to the same plan: no email", sent.length === 0, `${sent.length} sent`)

    reset()
    sub.stripe_subscription_id = "sub_stripe_x"
    const { stripe } = await import("../lib/stripe")
    ;(stripe.subscriptions as unknown as Row).cancel = async () => ({ id: "sub_stripe_x", status: "canceled" })
    await call({ action: "change_tier", tier: "FREE" })
    check("admin move to Free on a Stripe plan: left to the webhook's cancellation notice", sent.length === 0, `${sent.length} sent`)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
