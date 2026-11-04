// Usage: npx tsx --tsconfig tsconfig.json scripts/test-extended-trial.ts
// Admin extended trials (lib/extended-trial.ts, POST/DELETE
// /api/admin/subscriptions/extended-trial): grant, replace, refuse, revoke,
// expiry back to Free, plan caps during the trial, and the audit rows and
// admin email. Nothing touches a real database, Stripe or email: DATABASE_URL
// points at a closed local port, sql is an in-memory fake, notifyAdmin is
// replaced by a recorder, and any network call throws.

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_never_called"
process.env.JWT_ACCESS_SECRET = "extended-trial-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "extended-trial-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "extended-trial-test-admin-secret-not-real-0123456789"
delete process.env.RESEND_API_KEY

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake rows
type Row = Record<string, any>

const results: { name: string; pass: boolean; note?: string }[] = []
const check = (name: string, pass: boolean, note?: string) => {
  results.push({ name, pass, note })
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${!pass && note ? `\n        ${note}` : ""}`)
}

const DAY = 24 * 60 * 60 * 1000
const FAMILY = "fam-1"
const OWNER = "u-owner"
const OWNER_EMAIL = "owner@example.invalid"
const ADMIN_EMAIL = "ops@example.invalid"
const day = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10)
const near = (iso: string | Date | null | undefined, ms: number) => !!iso && Math.abs(new Date(iso).getTime() - ms) < 60_000

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken, checkFamilySubscription } = await import("../lib/auth")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const { NextRequest } = await import("next/server")
  const alerts = await import("../lib/admin-account-alerts")
  const ext = await import("../lib/extended-trial")
  const tierLimits = await import("../lib/tier-limits")
  const { getFamilyPremiumAccess } = await import("../lib/services/subscription")
  const { smsQuotaForFamily } = await import("../lib/services/sms")
  const { getTrialEligibility } = await import("../lib/trial-eligibility")
  const { SMS_PER_MONTH, TRIAL_SMS_QUOTA, EVENTS_PER_MONTH } = await import("../lib/subscription-tiers")
  const route = await import("../app/api/admin/subscriptions/extended-trial/route")
  const userSubs = await import("../app/api/subscriptions/route")

  const sent: { subject: string; html: string; text: string }[] = []
  alerts.accountAlertDeps.notifyAdmin = async (subject: string, html: string, text?: string) => {
    sent.push({ subject, html, text: text ?? "" })
  }
  let networkCalls = 0
  globalThis.fetch = (async (url: string | URL) => {
    networkCalls++
    throw new Error(`unexpected network call: ${url}`)
  }) as typeof fetch

  // ---- fake database ------------------------------------------------------------
  // Not narrowed to null: the fake's handlers reassign it.
  let sub = null as Row | null
  let lastTrialStart: string | null = null
  const history: Row[] = []
  const adminLogs: Row[] = []
  const auditLogs: Row[] = []
  const queries: string[] = []
  const reset = (row: Row | null) => {
    sent.length = 0
    history.length = 0
    adminLogs.length = 0
    auditLogs.length = 0
    queries.length = 0
    lastTrialStart = null
    sub = row ? { id: "sub-1", family_id: FAMILY, created_at: "2026-01-01T00:00:00Z", stripe_subscription_id: null, trial_source: null, trial_ends_at: null, cancel_at_period_end: false, ...row } : null
  }
  const copy = () => (sub ? [{ ...sub }] : [])
  const nowIso = () => new Date().toISOString()
  const handlers: [string, (v: unknown[]) => Row[]][] = [
    ["FROM admin_users", (v) => (v[0] === "admin-super" || v[0] === "admin-support" ? [{ id: v[0], email: ADMIN_EMAIL, status: "ACTIVE", mfa_enabled: true }] : [])],
    ["FROM admin_roles r", (v) => [{ name: v[0] === "admin-super" ? "SUPER_ADMIN" : "SUPPORT" }]],
    ["SELECT DISTINCT p.key", () => [{ key: "subscriptions.read" }]],
    ["FROM users WHERE id = ? AND is_active = true", () => [{ id: OWNER, email: OWNER_EMAIL, first_name: "Ana", last_name: "Rivera", is_active: true, member_id: "m-1", role: "PARENT", family_id: FAMILY, family_name: "Rivera Family", owner_id: OWNER }]],
    ["SELECT id, name FROM families WHERE id", (v) => (v[0] === FAMILY ? [{ id: FAMILY, name: "Rivera Family" }] : [])],
    ["SELECT u.email, f.name FROM families f JOIN users u", () => [{ email: OWNER_EMAIL, name: "Rivera Family" }]],
    ["SELECT fm.role, f.owner_id FROM family_members fm", () => [{ role: "PARENT", owner_id: OWNER }]],
    ["SELECT s.*, f.name as family_name", () => (sub ? [{ ...sub, family_name: "Rivera Family", owner_id: OWNER }] : [])],
    ["AS last_started_at", () => [{ last_started_at: lastTrialStart }]],
    // Grant over an existing row (only when Stripe isn't billing it).
    ["UPDATE subscriptions SET tier = ?, status = 'TRIALING'", (v) => {
      if (!sub || (sub.stripe_subscription_id && sub.status !== "CANCELLED")) return []
      Object.assign(sub, { tier: v[0], status: "TRIALING", trial_ends_at: v[1], current_period_end: v[2], stripe_subscription_id: null, trial_source: v[3], cancel_at_period_end: false })
      return [{ id: sub.id }]
    }],
    ["INSERT INTO subscriptions (", (v) => {
      sub = { id: v[0], family_id: v[1], tier: v[2], status: "TRIALING", trial_ends_at: v[3], current_period_end: v[4], trial_source: v[5], stripe_subscription_id: null, created_at: nowIso(), cancel_at_period_end: false }
      return []
    }],
    // Revoke.
    ["UPDATE subscriptions SET tier = 'FREE', status = 'ACTIVE', trial_ends_at = NOW()", (v) => {
      if (!sub || sub.id !== v[0] || sub.status !== "TRIALING" || sub.stripe_subscription_id || sub.trial_source !== v[1]) return []
      Object.assign(sub, { tier: "FREE", status: "ACTIVE", trial_ends_at: nowIso(), current_period_end: nowIso(), trial_source: null })
      return [{ id: sub.id }]
    }],
    // Daily expiry (endExpiredTrials).
    ["UPDATE subscriptions SET tier = 'FREE', status = 'ACTIVE', trial_source = NULL", () => {
      if (!sub || sub.status !== "TRIALING" || !sub.trial_ends_at || new Date(sub.trial_ends_at).getTime() >= Date.now() || sub.stripe_subscription_id) return []
      Object.assign(sub, { tier: "FREE", status: "ACTIVE", trial_source: null })
      return [{ id: sub.id }]
    }],
    ["INSERT INTO subscription_status_history", (v) => { history.push({ values: v }); return [] }],
    ["INSERT INTO admin_action_logs", (v) => { adminLogs.push({ action: v[1], targetId: v[3], metadata: JSON.parse(String(v[4])) }); return [] }],
    ["INSERT INTO audit_logs", (v) => { auditLogs.push({ userId: v[1], action: v[2], entityType: v[3], entityId: v[4], oldValue: v[5], newValue: v[6], metadata: v[7] }); return [] }],
    ["SELECT tier, status, trial_ends_at, stripe_subscription_id, trial_source FROM subscriptions", copy],
    ["SELECT id, tier, status, trial_ends_at, stripe_subscription_id, trial_source FROM subscriptions", copy],
    ["SELECT id, family_id, tier, status, current_period_start", copy],
    ["SELECT tier, status, trial_ends_at FROM subscriptions WHERE family_id = ? AND status IN", () => (sub && ["ACTIVE", "TRIALING"].includes(sub.status) ? copy() : [])],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    queries.push(q)
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const realError = console.error
  const quiet = async <T,>(fn: () => Promise<T>) => {
    console.error = () => {}
    try { return await fn() } finally { console.error = realError }
  }

  const adminFor = (id: string, roles: string[], permissions: string[]) =>
    generateAdminAccessToken({ id, email: ADMIN_EMAIL, firstName: "O", lastName: "Ps", status: "ACTIVE", mfaEnabled: true, roles, permissions } as Parameters<typeof generateAdminAccessToken>[0])
  const adminToken = await adminFor("admin-super", ["SUPER_ADMIN"], [])
  const supportToken = await adminFor("admin-support", ["SUPPORT"], ["subscriptions.read"])
  const userToken = await generateAccessToken(OWNER)
  const req = (method: string, token: string | null, body: Row, path = "/api/admin/subscriptions/extended-trial") =>
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    })
  const grant = (body: Row, token: string | null = adminToken) => quiet(() => route.POST(req("POST", token, { familyId: FAMILY, ...body })))
  const revoke = (body: Row = {}, token: string | null = adminToken) => quiet(() => route.DELETE(req("DELETE", token, { familyId: FAMILY, ...body })))
  const freeRow = { tier: "FREE", status: "ACTIVE" }

  // ===== grant ======================================================================
  console.log("Grant Plus for 14 days")
  {
    reset(freeRow)
    const res = await grant({ tier: "PREMIUM", days: 14, note: "Play closed-test tester" })
    const body = await res.json()
    check("200 and kind grant", res.status === 200 && body.kind === "grant", JSON.stringify(body))
    check("row is Plus (PREMIUM), TRIALING, admin-granted", sub?.tier === "PREMIUM" && sub?.status === "TRIALING" && sub?.trial_source === "ADMIN_EXTENDED", JSON.stringify(sub))
    check("trial ends 14 days from now (trial_ends_at and period end)", near(sub?.trial_ends_at, Date.now() + 14 * DAY) && near(sub?.current_period_end, Date.now() + 14 * DAY))
    check("no Stripe ids on the row, no network call", !sub?.stripe_subscription_id && networkCalls === 0)
    check("no query touches Stripe customers, invoices or payments", !queries.some((q) => /payment_transactions|stripe_customer_id =|invoice/i.test(q)))
    check("message uses the plan name", body.message === `Rivera Family has Plus free until ${day(Date.now() + 14 * DAY)}.`, body.message)
  }

  console.log("Grant Premium for 90 days (family with no subscription row)")
  {
    reset(null)
    const res = await grant({ tier: "PREMIUM_PLUS", days: 90 })
    check("200", res.status === 200)
    check("new row: PREMIUM_PLUS, TRIALING, ends in 90 days", sub?.tier === "PREMIUM_PLUS" && sub?.status === "TRIALING" && near(sub?.trial_ends_at, Date.now() + 90 * DAY), JSON.stringify(sub))
    check("status history written", history.length === 1 && String(history[0].values[3]).includes("Extended 90-day Premium trial"))
  }

  // ===== validation =================================================================
  console.log("Input validation")
  {
    reset(freeRow)
    for (const tier of ["FREE", "GOLD", "", undefined]) {
      const res = await grant({ tier, days: 14 })
      check(`tier ${JSON.stringify(tier)} -> 400`, res.status === 400)
    }
    for (const days of [0, 366, -3, 1.5, "abc", null]) {
      const res = await grant({ tier: "PREMIUM", days })
      check(`days ${JSON.stringify(days)} -> 400`, res.status === 400)
    }
    const okEdge = await grant({ tier: "PREMIUM", days: 365 })
    check("days 365 accepted", okEdge.status === 200)
    reset(freeRow)
    const longNote = await grant({ tier: "PREMIUM", days: 14, note: "x".repeat(201) })
    check("note over 200 chars -> 400", longNote.status === 400)
    const noFamily = await grant({ tier: "PREMIUM", days: 14, familyId: "fam-missing" })
    check("unknown family -> 404", noFamily.status === 404)
    check("nothing written by refused requests", sub?.tier === "FREE" && sub?.status === "ACTIVE" && sent.length === 0)
  }

  // ===== auth =======================================================================
  console.log("Only admins with subscriptions.update")
  {
    reset(freeRow)
    const none = await grant({ tier: "PREMIUM", days: 14 }, null)
    const user = await grant({ tier: "PREMIUM", days: 14 }, userToken)
    const support = await grant({ tier: "PREMIUM", days: 14 }, supportToken)
    const supportRevoke = await revoke({}, supportToken)
    check("no token -> 401", none.status === 401)
    check("family owner's user token -> 401", user.status === 401)
    check("admin without subscriptions.update -> 401 (grant and revoke)", support.status === 401 && supportRevoke.status === 401)
    check("row unchanged", sub?.tier === "FREE" && sub?.status === "ACTIVE")
  }

  // ===== paying families ============================================================
  console.log("Paying families are refused with 409")
  {
    const paying = { tier: "PREMIUM_PLUS", status: "ACTIVE", stripe_subscription_id: "sub_live_best_of_best" }
    reset(paying)
    const res = await grant({ tier: "PREMIUM", days: 30 })
    const body = await res.json()
    check("Stripe ACTIVE -> 409 PAYING", res.status === 409 && body.code === "PAYING", JSON.stringify(body))
    check("Stripe row untouched", sub?.tier === "PREMIUM_PLUS" && sub?.status === "ACTIVE" && sub?.stripe_subscription_id === "sub_live_best_of_best")
    check("no email, no audit", sent.length === 0 && adminLogs.length === 0 && auditLogs.length === 0)
    reset({ tier: "PREMIUM", status: "PAST_DUE", stripe_subscription_id: "sub_past_due" })
    check("Stripe PAST_DUE -> 409", (await grant({ tier: "PREMIUM", days: 30 })).status === 409)
    reset({ tier: "PREMIUM", status: "ACTIVE" })
    check("paid ACTIVE plan without Stripe (Change tier) -> 409", (await grant({ tier: "PREMIUM_PLUS", days: 30 })).status === 409)
    reset(paying)
    const rv = await revoke()
    check("revoke on a Stripe family -> 409, untouched", rv.status === 409 && sub?.stripe_subscription_id === "sub_live_best_of_best" && sub?.status === "ACTIVE")
    reset({ tier: "FREE", status: "CANCELLED", stripe_subscription_id: "sub_cancelled_old" })
    const after = await grant({ tier: "PREMIUM", days: 14 })
    check("cancelled Stripe subscription: granted, old id cleared so expiry applies", after.status === 200 && sub?.stripe_subscription_id === null && sub?.status === "TRIALING")
  }

  // ===== trial already used =========================================================
  console.log("A family that used its free trial can still be granted")
  {
    reset(freeRow)
    lastTrialStart = new Date(Date.now() - 30 * DAY).toISOString()
    const elig = await getTrialEligibility(OWNER, FAMILY)
    check("normal trial is not available (used 30 days ago)", elig.eligible === false)
    const res = await grant({ tier: "PREMIUM", days: 30 })
    check("extended trial granted anyway", res.status === 200 && sub?.status === "TRIALING")
    check("the trial-eligibility check is never run by the route", !queries.slice(1).some((q) => q.includes("last_started_at")))
  }

  // ===== replace vs refuse ==========================================================
  console.log("Replace vs refuse")
  {
    reset({ tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: new Date(Date.now() + 90 * DAY).toISOString(), trial_source: "ADMIN_EXTENDED" })
    const refused = await grant({ tier: "PREMIUM", days: 14 })
    const rb = await refused.json()
    check("longer extended trial, no replace -> 409 LONGER_TRIAL", refused.status === 409 && rb.code === "LONGER_TRIAL", JSON.stringify(rb))
    check("existing trial kept", sub?.tier === "PREMIUM_PLUS" && near(sub?.trial_ends_at, Date.now() + 90 * DAY))
    const replaced = await grant({ tier: "PREMIUM", days: 14, replace: true })
    const pb = await replaced.json()
    check("replace: true -> 200 kind replace, now Plus for 14 days", replaced.status === 200 && pb.kind === "replace" && sub?.tier === "PREMIUM" && near(sub?.trial_ends_at, Date.now() + 14 * DAY), JSON.stringify(pb))
    check("replace email subject", sent[0]?.subject === `[Togethr] Account change: Extended trial replaced by admin - ${OWNER_EMAIL}`, sent[0]?.subject)
    check("replace email names the previous trial", sent[0]?.text.includes(`previous: Premium trial until ${day(Date.now() + 90 * DAY)}`), sent[0]?.text)
    check("admin log action REPLACE_EXTENDED_TRIAL", adminLogs[0]?.action === "REPLACE_EXTENDED_TRIAL")

    reset({ tier: "PREMIUM", status: "TRIALING", trial_ends_at: new Date(Date.now() + 5 * DAY).toISOString(), trial_source: "ADMIN_EXTENDED" })
    const longer = await grant({ tier: "PREMIUM_PLUS", days: 60 })
    check("shorter extended trial is extended without the flag (kind replace)", longer.status === 200 && (await longer.json()).kind === "replace")

    reset({ tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: new Date(Date.now() + 6 * DAY).toISOString() })
    const overUser = await grant({ tier: "PREMIUM", days: 3 })
    check("an ordinary trial that ends later is also protected", overUser.status === 409)
  }

  // ===== revoke =====================================================================
  console.log("Revoke returns the family to Free")
  {
    reset(freeRow)
    await grant({ tier: "PREMIUM_PLUS", days: 60 })
    sent.length = 0
    adminLogs.length = 0
    auditLogs.length = 0
    const res = await revoke({ note: "Tester left the program" })
    check("200", res.status === 200)
    check("row FREE / ACTIVE, trial ended, source cleared", sub?.tier === "FREE" && sub?.status === "ACTIVE" && sub?.trial_source === null && new Date(sub!.trial_ends_at).getTime() <= Date.now())
    const access = await checkFamilySubscription(FAMILY)
    check("access is Free right away", access.tier === "FREE" && access.trial !== true)
    check("revoke email subject", sent[0]?.subject === `[Togethr] Account change: Extended trial cancelled by admin - ${OWNER_EMAIL}`, sent[0]?.subject)
    check("revoke email shows plan Premium -> Free and the note", sent[0]?.text.includes("plan: Premium -> Free") && sent[0]?.text.includes("note: Tester left the program"), sent[0]?.text)
    check("admin log REVOKE_EXTENDED_TRIAL and audit row", adminLogs[0]?.action === "REVOKE_EXTENDED_TRIAL" && auditLogs.length === 1)
    const again = await revoke()
    check("revoking again -> 409 (no active extended trial)", again.status === 409)
    reset({ tier: "PREMIUM", status: "TRIALING", trial_ends_at: new Date(Date.now() + 5 * DAY).toISOString() })
    check("an ordinary user trial can't be revoked here", (await revoke()).status === 409 && sub?.status === "TRIALING")
  }

  // ===== expiry =====================================================================
  console.log("Expiry falls back to Free")
  {
    reset(freeRow)
    await grant({ tier: "PREMIUM", days: 14 })
    sub!.trial_ends_at = new Date(Date.now() - 60_000).toISOString()
    const access = await checkFamilySubscription(FAMILY)
    check("on read: checkFamilySubscription is Free", access.tier === "FREE" && access.trial !== true, JSON.stringify(access))
    const premium = await getFamilyPremiumAccess(FAMILY)
    check("on read: getFamilyPremiumAccess is Free", premium.tier === "FREE" && premium.hasPremium === false)
    const caps = await tierLimits.limitTier(FAMILY)
    check("on read: plan caps are Free's", caps.tier === "FREE" && caps.trial === false, JSON.stringify(caps))
    const sms = await smsQuotaForFamily(FAMILY)
    check("on read: SMS allowance is Free's", sms.quota === SMS_PER_MONTH.FREE && sms.trial === false, JSON.stringify(sms))
    check("not an active extended trial any more", (await ext.extendedTrialTier(FAMILY)) === null)
    const ended = await ext.endExpiredTrials()
    check("daily expiry flips the row to FREE / ACTIVE and clears the source", ended === 1 && sub?.tier === "FREE" && sub?.status === "ACTIVE" && sub?.trial_source === null, JSON.stringify(sub))
    check("expiry leaves a Stripe-billed row alone", await (async () => {
      reset({ tier: "PREMIUM", status: "TRIALING", trial_ends_at: new Date(Date.now() - DAY).toISOString(), stripe_subscription_id: "sub_x" })
      return (await ext.endExpiredTrials()) === 0 && sub?.tier === "PREMIUM"
    })())
  }

  // ===== limits during the trial ====================================================
  console.log("Limits match the granted plan during the trial")
  {
    reset(freeRow)
    await grant({ tier: "PREMIUM", days: 14 })
    const plus = await checkFamilySubscription(FAMILY)
    check("Plus: features are Plus's (5 children, alerts on, no emergency alerts)", plus.tier === "PREMIUM" && plus.trial === true && plus.features.maxChildren === 5 && plus.features.geofencing && !plus.features.phoneAlerts)
    const plusCaps = await tierLimits.limitTier(FAMILY)
    check("Plus: plan caps are Plus's", plusCaps.tier === "PREMIUM" && plusCaps.trial === true, JSON.stringify(plusCaps))
    const plusEvents = await tierLimits.checkLimit(FAMILY, "eventsPerMonth")
    check(`Plus: ${EVENTS_PER_MONTH.PLUS} events a month`, plusEvents.limit === EVENTS_PER_MONTH.PLUS && plusEvents.allowed)
    check("Plus: SMS allowance is Plus's", (await smsQuotaForFamily(FAMILY)).quota === SMS_PER_MONTH.PLUS)
    check("Plus: getFamilyPremiumAccess is Plus", (await getFamilyPremiumAccess(FAMILY)).tier === "PREMIUM")

    reset(freeRow)
    await grant({ tier: "PREMIUM_PLUS", days: 90 })
    const prem = await checkFamilySubscription(FAMILY)
    check("Premium: unlimited children, emergency alerts", prem.tier === "PREMIUM_PLUS" && prem.features.maxChildren === -1 && prem.features.phoneAlerts)
    const premEvents = await tierLimits.checkLimit(FAMILY, "eventsPerMonth")
    check("Premium: unlimited events", premEvents.limit === null && premEvents.tier === "PREMIUM_PLUS")
    check("Premium: SMS allowance is Premium's", (await smsQuotaForFamily(FAMILY)).quota === SMS_PER_MONTH.PREMIUM)

    reset({ tier: "PREMIUM", status: "TRIALING", trial_ends_at: new Date(Date.now() + 5 * DAY).toISOString() })
    const userTrial = await tierLimits.limitTier(FAMILY)
    check("ordinary user trial unchanged: Premium caps, trial SMS allowance", userTrial.tier === "PREMIUM_PLUS" && (await smsQuotaForFamily(FAMILY)).quota === TRIAL_SMS_QUOTA)
  }

  // ===== what the family sees =======================================================
  console.log("The family's subscription page data")
  {
    reset(freeRow)
    lastTrialStart = new Date(Date.now() - 30 * DAY).toISOString()
    await grant({ tier: "PREMIUM", days: 30 })
    const res = await userSubs.GET(req("GET", userToken, {}, `/api/subscriptions?familyId=${FAMILY}`))
    const data = (await res.json()).data
    check("Plus, TRIALING, with the end date", data?.tier === "PREMIUM" && data?.status === "TRIALING" && near(data?.trialEndsAt, Date.now() + 30 * DAY), JSON.stringify(data))
    check("no 'used your free trial' data while it runs (trial: null)", data?.trial === null)
    check("not shown as Stripe billed, so Upgrade goes to a new checkout", data?.stripeBilled === false)
  }

  // ===== audit and email ============================================================
  console.log("Audit and admin email on grant")
  {
    reset(freeRow)
    await grant({ tier: "PREMIUM", days: 14, note: "Play closed-test tester" })
    const ends = day(Date.now() + 14 * DAY)
    const log = adminLogs[0]
    check("admin action log GRANT_EXTENDED_TRIAL with tier, days, end and note", log?.action === "GRANT_EXTENDED_TRIAL" && log.targetId === "sub-1" && log.metadata.tier === "PREMIUM" && log.metadata.days === 14 && log.metadata.trialEnds === ends && log.metadata.note === "Play closed-test tester", JSON.stringify(log))
    const audit = auditLogs[0]
    const meta = audit ? JSON.parse(String(audit.metadata)) : {}
    check("audit_logs row: UPDATE subscription_trial for the family, admin-granted", audit?.action === "UPDATE" && audit.entityType === "subscription_trial" && audit.entityId === FAMILY && meta.source === "ADMIN_EXTENDED" && meta.days === 14 && meta.adminId === "admin-super", JSON.stringify(audit))
    check("one email", sent.length === 1)
    const mail = sent[0]
    check("subject style", mail?.subject === `[Togethr] Account change: Extended trial granted by admin - ${OWNER_EMAIL}`, mail?.subject)
    check("body: plan, days, end date, note, admin", ["plan: Plus", "days: 14", `trialEnds: ${ends}`, "note: Play closed-test tester", `${ADMIN_EMAIL} (admin portal)`, "Family: Rivera Family"].every((s) => mail?.text.includes(s)), mail?.text)
    const all = `${mail?.subject}\n${mail?.html}\n${mail?.text}`
    const secrets = [adminToken, userToken, process.env.ADMIN_JWT_SECRET!, process.env.JWT_ACCESS_SECRET!, process.env.STRIPE_SECRET_KEY!]
    check("no tokens or secrets in the email", secrets.every((s) => !all.includes(s)))
    check("no tokens or secrets in the audit rows", secrets.every((s) => !JSON.stringify([adminLogs, auditLogs]).includes(s)))
  }

  console.log("Pure rules")
  {
    const now = new Date("2026-11-04T12:00:00Z")
    check("parse: string days accepted, note trimmed, replace defaults false", JSON.stringify(ext.parseExtendedTrialInput({ familyId: " f ", tier: "PREMIUM", days: "30", note: "  hi " })) === JSON.stringify({ ok: true, input: { familyId: "f", tier: "PREMIUM", days: 30, note: "hi", replace: false } }))
    check("parse: missing familyId refused", !ext.parseExtendedTrialInput({ tier: "PREMIUM", days: 3 }).ok)
    const d = ext.decideGrant(null, { days: 14, replace: false }, now)
    check("decide: no row -> grant ending now + 14 days", d.ok && d.kind === "grant" && d.endsAt.toISOString() === "2026-11-18T12:00:00.000Z")
    check("decide: expired extended trial -> plain grant", (() => {
      const r = ext.decideGrant({ tier: "PREMIUM", status: "TRIALING", trial_ends_at: "2026-11-01T00:00:00Z", stripe_subscription_id: null, trial_source: "ADMIN_EXTENDED" }, { days: 14, replace: false }, now)
      return r.ok && r.kind === "grant"
    })())
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

// A module, so its names don't clash with the other test scripts.
export {}
