// Usage: npx tsx --tsconfig tsconfig.json scripts/test-payment-e2e.ts
// The payment path through the real routes (checkout, portal, resume, Stripe
// webhook, admin trial grant, admin promo codes) on an in-memory fake
// database with Stripe's API stubbed in process. Nothing touches a real
// database, Stripe or email: DATABASE_URL points at a closed local port, the
// Stripe key is a placeholder, every Stripe method used is replaced, and any
// other network call throws.
//
// Unlike the other suites this one records each check as PASS or FAIL and
// keeps going, so known gaps show up as findings (e2e-payment-report.md);
// it exits 1 when any check fails. Signed-out requests aren't covered: with no
// token getUserFromRequest reads next/headers cookies(), which only works
// inside a real Next.js request.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_never_called"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_payment_e2e_not_real"
process.env.JWT_ACCESS_SECRET = "payment-e2e-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "payment-e2e-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "payment-e2e-test-admin-secret-not-real-0123456789"
process.env.STRIPE_PRICE_BASIC_MONTHLY = "price_plus_m"
process.env.STRIPE_PRICE_BASIC_ANNUAL = "price_plus_y"
process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_prem_m"
process.env.STRIPE_PRICE_PREMIUM_ANNUAL = "price_prem_y"
delete process.env.RESEND_API_KEY
delete process.env.STRIPE_TAX_ENABLED

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake rows and Stripe objects
type Row = Record<string, any>

const results: { name: string; pass: boolean; note?: string }[] = []
const check = (name: string, pass: boolean, note?: string) => {
  results.push({ name, pass, note })
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${!pass && note ? `\n        ${note}` : ""}`)
}

const OWNER_FREE = "u-owner-free"
const OWNER_PAID = "u-owner-paid"
const COPARENT = "u-coparent"
const CHILD = "u-child"
const STRANGER = "u-stranger"

const PRICES: Record<string, Row> = {
  price_plus_m: { id: "price_plus_m", product: "prod_plus", unit_amount: 599, recurring: { interval: "month", interval_count: 1 } },
  price_plus_y: { id: "price_plus_y", product: "prod_plus", unit_amount: 5990, recurring: { interval: "year", interval_count: 1 } },
  price_prem_m: { id: "price_prem_m", product: "prod_prem", unit_amount: 999, recurring: { interval: "month", interval_count: 1 } },
  price_prem_y: { id: "price_prem_y", product: "prod_prem", unit_amount: 9990, recurring: { interval: "year", interval_count: 1 } },
}

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const { NextRequest } = await import("next/server")
  const { stripe } = await import("../lib/stripe")
  const webhook = await import("../app/api/webhooks/stripe/route")
  const checkout = await import("../app/api/subscription/checkout/route")
  const portal = await import("../app/api/subscription/portal/route")
  const resume = await import("../app/api/subscription/resume/route")
  const promoCheck = await import("../app/api/subscription/promo-check/route")
  const adminSub = await import("../app/api/admin/subscriptions/[subscriptionId]/route")
  const adminPromo = await import("../app/api/admin/promo-codes/route")
  const familySub = await import("../app/api/subscriptions/[familyId]/route")
  const { parseUpgradeParams, planChange, upgradePageCopy, downgradeNotice, confirmationCopy } = await import("../lib/upgrade-order")

  // ---- fake database ------------------------------------------------------------
  const families: Row = {
    "fam-free": { owner_id: OWNER_FREE, name: "Free Family", members: { [OWNER_FREE]: "PARENT", [CHILD]: "CHILD" } },
    "fam-paid": { owner_id: OWNER_PAID, name: "Paid Family", members: { [OWNER_PAID]: "PARENT", [COPARENT]: "PARENT" } },
  }
  let subs: Row[] = []
  let history: Row[] = []
  let payments: Row[] = []
  let adminLog: Row[] = []
  const reset = () => {
    subs = [
      { id: "sub-free", family_id: "fam-free", tier: "FREE", status: "ACTIVE", stripe_customer_id: null, stripe_subscription_id: null, stripe_price_id: null },
      { id: "sub-paid", family_id: "fam-paid", tier: "PREMIUM_PLUS", status: "ACTIVE", stripe_customer_id: "cus_paid", stripe_subscription_id: "sub_stripe_paid", stripe_price_id: "price_prem_m" },
    ]
    history = []
    payments = []
    adminLog = []
  }
  reset()
  const subBy = (k: string, v: unknown) => subs.filter((s) => s[k] === v)
  const queries: string[] = []

  const handlers: [string, (v: unknown[]) => Row[]][] = [
    ["FROM users WHERE id =", (v) => [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: String(v[0]), last_name: "", is_active: true }]],
    ["FROM admin_users", (v) => (v[0] === "admin-super" ? [{ id: v[0], email: "a@example.invalid", status: "ACTIVE", mfa_enabled: true }] : [])],
    ["FROM admin_roles r", (v) => (v[0] === "admin-super" ? [{ name: "SUPER_ADMIN" }] : [])],
    ["SELECT DISTINCT p.key", () => []],
    ["INSERT INTO admin_action_logs", (v) => { adminLog.push({ action: v[1], target: v[3] }); return [] }],
    // membership + owner (checkout / portal / resume)
    ["FROM family_members fm JOIN families f ON f.id = fm.family_id WHERE fm.family_id", (v) => {
      const f = families[v[0] as string]
      const role = f?.members[v[1] as string]
      return role ? [{ role, owner_id: f.owner_id, family_name: f.name }] : []
    }],
    ["SELECT f.name AS family_name, u.email AS owner_email", (v) => {
      const f = families[v[0] as string]
      return f ? [{ family_name: f.name, owner_email: `${f.owner_id}@example.invalid` }] : []
    }],
    ["SELECT * FROM subscriptions WHERE family_id", (v) => subBy("family_id", v[0])],
    ["SELECT stripe_customer_id FROM subscriptions WHERE family_id", (v) => subBy("family_id", v[0])],
    ["SELECT stripe_subscription_id FROM subscriptions WHERE family_id", (v) => subBy("family_id", v[0])],
    ["SELECT * FROM subscriptions WHERE stripe_customer_id", (v) => subBy("stripe_customer_id", v[0])],
    ["SELECT * FROM subscriptions WHERE id", (v) => subBy("id", v[0])],
    ["UPDATE subscriptions SET stripe_customer_id = ?, updated_at = NOW() WHERE family_id", (v) => {
      for (const s of subBy("family_id", v[1])) s.stripe_customer_id = v[0]
      return []
    }],
    // webhook: activate (10 values) and sync (11 values, trial_ends_at); family id is last
    ["UPDATE subscriptions SET tier = ?, status = ?, stripe_customer_id = ?", (v) => {
      for (const s of subBy("family_id", v[v.length - 1])) {
        Object.assign(s, { tier: v[0], status: v[1], stripe_customer_id: v[2], stripe_subscription_id: v[3], stripe_price_id: v[4], current_period_start: v[5], current_period_end: v[6] })
      }
      return []
    }],
    ["UPDATE subscriptions SET tier = 'FREE', status = 'CANCELLED'", (v) => {
      for (const s of subBy("family_id", v[v.length - 1])) Object.assign(s, { tier: "FREE", status: "CANCELLED" })
      return []
    }],
    ["UPDATE subscriptions SET status = 'PAST_DUE'", (v) => {
      for (const s of subBy("family_id", v[0])) s.status = "PAST_DUE"
      return []
    }],
    ["UPDATE subscriptions SET status = 'ACTIVE', updated_at = NOW() WHERE id = ? AND status = 'PAST_DUE'", (v) => {
      for (const s of subBy("id", v[0])) if (s.status === "PAST_DUE") s.status = "ACTIVE"
      return []
    }],
    // self-service trial (app/api/subscriptions/[familyId])
    ["SELECT owner_id FROM families WHERE id", (v) => (families[v[0] as string] ? [{ owner_id: families[v[0] as string].owner_id }] : [])],
    ["SELECT id, tier, status, stripe_subscription_id FROM subscriptions", (v) => subBy("family_id", v[0])],
    ["UPDATE subscriptions SET tier = ?, status = 'TRIALING'", (v) => {
      for (const s of subBy("id", v[v.length - 1])) Object.assign(s, { tier: v[0], status: "TRIALING", trial_ends_at: v[1] })
      return []
    }],
    // admin
    ["UPDATE subscriptions SET tier = 'PREMIUM_PLUS', status = 'TRIALING'", (v) => {
      for (const s of subBy("id", v[v.length - 1])) Object.assign(s, { tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: v[0] })
      return []
    }],
    ["INSERT INTO subscription_status_history", (v) => { history.push({ v }); return [] }],
    ["SELECT id FROM payment_transactions WHERE stripe_payment_id", (v) => payments.filter((p) => p.stripe_payment_id === v[0])],
    ["UPDATE payment_transactions SET status = ? WHERE stripe_payment_id", (v) => {
      for (const p of payments) if (p.stripe_payment_id === v[1]) p.status = v[0]
      return []
    }],
    ["INSERT INTO payment_transactions", (v) => {
      payments.push({ subscription_id: v[0], stripe_payment_id: v[1], amount: v[2], currency: v[3], status: v[4], description: v[5] })
      return []
    }],
  ]
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    queries.push(q)
    for (const [needle, fn] of handlers) if (q.includes(needle)) return fn(v)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  globalThis.fetch = (async (url: string | URL) => { throw new Error(`unexpected network call: ${url}`) }) as typeof fetch

  // ---- fake Stripe ------------------------------------------------------------------
  const stripeSubs: Record<string, Row> = {}
  const stripeCalls: { method: string; args: unknown[] }[] = []
  const resetStripe = () => {
    for (const k of Object.keys(stripeSubs)) delete stripeSubs[k]
    stripeSubs.sub_stripe_paid = {
      id: "sub_stripe_paid", status: "active", customer: "cus_paid", metadata: { familyId: "fam-paid" },
      cancel_at_period_end: false, cancel_at: null,
      items: { data: [{ id: "si_paid", price: PRICES.price_prem_m, current_period_start: 1761000000, current_period_end: 1763600000 }] },
    }
    stripeCalls.length = 0
  }
  resetStripe()
  const stub = (obj: Row, method: string, fn: (...args: unknown[]) => unknown) => {
    obj[method] = async (...args: unknown[]) => { stripeCalls.push({ method, args }); return fn(...args) }
  }
  const s = stripe as unknown as Row
  stub(s.subscriptions, "retrieve", (id) => {
    if (!stripeSubs[id as string]) throw Object.assign(new Error("No such subscription"), { code: "resource_missing" })
    return stripeSubs[id as string]
  })
  stub(s.subscriptions, "update", (id, p) => {
    const sub = stripeSubs[id as string]
    const params = p as Row
    if (params.items) sub.items.data[0].price = PRICES[params.items[0].price]
    if ("cancel_at_period_end" in params) sub.cancel_at_period_end = params.cancel_at_period_end
    return sub
  })
  stub(s.prices, "retrieve", (id) => PRICES[id as string])
  stub(s.customers, "retrieve", (id) => ({ id, deleted: false }))
  stub(s.customers, "create", () => ({ id: "cus_new" }))
  stub(s.checkout.sessions, "create", () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }))
  stub(s.billingPortal.sessions, "create", () => ({ url: "https://billing.stripe.com/p/session/test" }))
  stub(s.invoices, "retrieve", (id) => ({ id, status: id === "in_retried_ok" ? "paid" : "open" }))
  stub(s.promotionCodes, "list", () => ({ data: [] }))
  stub(s.coupons, "create", () => {
    throw Object.assign(new Error("The provided key 'rk_live_...abc' does not have the required permissions for this endpoint on account 'acct_x'. Having the 'rak_coupon_write' permission would allow this request to continue."), { type: "StripePermissionError", statusCode: 403 })
  })
  const callsOf = (m: string) => stripeCalls.filter((c) => c.method === m)

  // ---- helpers --------------------------------------------------------------------------
  const tokens: Record<string, string> = {}
  for (const u of [OWNER_FREE, OWNER_PAID, COPARENT, CHILD, STRANGER]) tokens[u] = await generateAccessToken(u)
  const adminToken = await generateAdminAccessToken({ id: "admin-super", email: "a@example.invalid", firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: true, roles: ["SUPER_ADMIN"], permissions: [] } as Parameters<typeof generateAdminAccessToken>[0])
  const post = (path: string, user: string | null, body: Row, extra: Record<string, string> = {}) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${tokens[user] ?? user}` } : {}), ...extra },
      body: JSON.stringify(body),
    })
  const realError = console.error
  const realWarn = console.warn
  const quiet = async <T,>(fn: () => Promise<T>) => {
    console.error = () => {}
    console.warn = () => {}
    try { return await fn() } finally { console.error = realError; console.warn = realWarn }
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET!
  const event = (id: string, type: string, object: Row) =>
    JSON.stringify({ id, object: "event", type, livemode: false, created: 1761000000, api_version: "2026-08-26.dahlia", data: { object } })
  const send = (payload: string) =>
    quiet(() => webhook.POST(new NextRequest("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret }), "content-type": "application/json" },
      body: payload,
    })))
  const subWrites = () => queries.filter((q) => /^(UPDATE|INSERT INTO) subscriptions/.test(q)).length

  // ===== A. new subscription through the webhook ====================================
  console.log("A. checkout.session.completed -> Plus")
  {
    reset(); resetStripe()
    stripeSubs.sub_new = {
      id: "sub_new", status: "active", customer: "cus_new", metadata: { familyId: "fam-free" }, cancel_at_period_end: false, cancel_at: null,
      items: { data: [{ id: "si_new", price: PRICES.price_plus_m, current_period_start: 1761000000, current_period_end: 1763600000 }] },
    }
    const session = { id: "cs_1", object: "checkout.session", mode: "subscription", payment_status: "paid", subscription: "sub_new", customer: "cus_new", metadata: { familyId: "fam-free", requestedTier: "PREMIUM" } }
    const r1 = await send(event("evt_cs_1", "checkout.session.completed", session))
    const row = subBy("family_id", "fam-free")[0]
    check("A1 completed checkout: 200, tier Plus, ACTIVE, Stripe ids and period dates saved",
      r1.status === 200 && row.tier === "PREMIUM" && row.status === "ACTIVE" && row.stripe_subscription_id === "sub_new" &&
      row.current_period_end === new Date(1763600000 * 1000).toISOString())
    const hist = history.length
    await send(event("evt_cs_1", "checkout.session.completed", session))
    check("G2 redelivered checkout.session.completed: no second history row", history.length === hist, `history rows ${hist} -> ${history.length}`)

    // canceled before the redelivery: must not put the family back on a paid plan
    stripeSubs.sub_new.status = "canceled"
    await send(event("evt_cs_1", "checkout.session.completed", session))
    check("G2 checkout redelivered after cancel: stays/turns Free", subBy("family_id", "fam-free")[0].tier === "FREE")
  }

  console.log("G3. out of order: subscription.updated before checkout.session.completed")
  {
    reset(); resetStripe()
    const sub = {
      id: "sub_ooo", object: "subscription", status: "active", customer: "cus_ooo", metadata: { familyId: "fam-free" }, cancel_at_period_end: false, cancel_at: null, trial_end: null,
      items: { data: [{ id: "si_o", price: PRICES.price_prem_y, current_period_start: 1761000000, current_period_end: 1792536000 }] },
    }
    stripeSubs.sub_ooo = sub
    await send(event("evt_u_1", "customer.subscription.updated", sub))
    await send(event("evt_cs_2", "checkout.session.completed", { id: "cs_2", object: "checkout.session", mode: "subscription", payment_status: "paid", subscription: "sub_ooo", customer: "cus_ooo", metadata: { familyId: "fam-free", requestedTier: "PREMIUM_PLUS" } }))
    const row = subBy("family_id", "fam-free")[0]
    check("G3 converges: Premium, ACTIVE, the annual price", row.tier === "PREMIUM_PLUS" && row.status === "ACTIVE" && row.stripe_price_id === "price_prem_y")
  }

  console.log("E2. renewal fails, then is paid")
  {
    reset(); resetStripe()
    const inv = { id: "in_fail_1", object: "invoice", customer: "cus_paid", amount_due: 999, amount_paid: 0, currency: "usd", billing_reason: "subscription_cycle", parent: { type: "subscription_details", subscription_details: { subscription: "sub_stripe_paid", metadata: {} } } }
    await send(event("evt_f_1", "invoice.payment_failed", inv))
    await send(event("evt_f_1", "invoice.payment_failed", inv))
    const row = subBy("family_id", "fam-paid")[0]
    check("E2 payment_failed: PAST_DUE, one FAILED payment row even when redelivered",
      row.status === "PAST_DUE" && payments.filter((p) => p.stripe_payment_id === "in_fail_1").length === 1 && payments[0].status === "FAILED")
    await send(event("evt_p_1", "invoice.paid", { ...inv, amount_paid: 999 }))
    check("E2 invoice.paid on the same invoice: payment row COMPLETED", payments[0].status === "COMPLETED")
    check("E2 invoice.paid alone brings the family back to ACTIVE",
      subBy("family_id", "fam-paid")[0].status === "ACTIVE",
      `status ${subBy("family_id", "fam-paid")[0].status}: recordInvoicePayment doesn't clear PAST_DUE`)

    // A paid invoice for some other subscription leaves PAST_DUE alone.
    subBy("family_id", "fam-paid")[0].status = "PAST_DUE"
    await send(event("evt_p_2", "invoice.paid", { ...inv, id: "in_other_sub", amount_paid: 999, parent: { type: "subscription_details", subscription_details: { subscription: "sub_someone_else", metadata: {} } } }))
    check("E2 invoice.paid for another subscription: stays PAST_DUE", subBy("family_id", "fam-paid")[0].status === "PAST_DUE")
    subBy("family_id", "fam-paid")[0].status = "ACTIVE"
    await send(event("evt_f_2", "invoice.payment_failed", { ...inv, id: "in_retried_ok" }))
    check("E2 a stale payment_failed for an invoice already paid does not mark PAST_DUE",
      subBy("family_id", "fam-paid")[0].status === "ACTIVE")
  }

  console.log("G5. unhandled event types")
  {
    reset(); resetStripe()
    const before = subWrites()
    const realInfo = console.info
    const infos: string[] = []
    console.info = (...a: unknown[]) => { infos.push(a.join(" ")) }
    const r = await send(event("evt_x", "customer.created", { id: "cus_x", object: "customer" })).finally(() => { console.info = realInfo })
    check("G5 unhandled event: 200 and no writes", r.status === 200 && subWrites() === before)
    check("G5 unhandled event type is logged at info level", infos.some((l) => l.includes("customer.created")), `info lines: ${JSON.stringify(infos)}`)
  }

  // ===== C. plan changes from the upgrade page ======================================
  console.log("C1. paying Premium family opens /subscription/upgrade with no ?tier=")
  {
    // The page's selection and copy (lib/upgrade-order.ts), with the plan from /api/subscriptions.
    const current = { tier: "PREMIUM_PLUS" as const, billing: "monthly" as const }
    const sel = parseUpgradeParams(null, null, current)
    check("C1 no ?tier=: the page preselects the current plan (Premium monthly), not Plus", sel.tier === "PREMIUM_PLUS" && sel.billing === "monthly", JSON.stringify(sel))
    check("C1 no ?tier= with ?promo= only: still the current plan", parseUpgradeParams(null, null, { tier: "PREMIUM_PLUS", billing: "annual" }).tier === "PREMIUM_PLUS")
    check("C1 not paying: no ?tier= is still Plus / monthly", JSON.stringify(parseUpgradeParams(null, null)) === JSON.stringify({ tier: "PREMIUM", billing: "monthly" }))
    check("C1 an explicit ?tier= still wins over the current plan", parseUpgradeParams("PREMIUM", "annual", current).tier === "PREMIUM")
    const same = planChange(current, sel)
    check("C1 Continue on the current plan: 'You are already on this plan'", same === "same" && upgradePageCopy(same, "Premium", "monthly").button === "You are already on this plan")
    check("C1 cancel pending on the current plan: 'Keep Premium' (resumes)", upgradePageCopy(planChange(current, sel, true), "Premium", "monthly").button === "Keep Premium")
    const down = upgradePageCopy(planChange(current, { tier: "PREMIUM", billing: "monthly" }), "Plus", "monthly")
    check("C1 title and button for a downgrade: 'Switch to Plus (downgrade)'", down.title === "Switch to Plus (downgrade)" && down.button === "Switch to Plus (downgrade)", JSON.stringify(down))
    const up = upgradePageCopy(planChange({ tier: "PREMIUM", billing: "monthly" }, { tier: "PREMIUM_PLUS", billing: "monthly" }), "Premium", "monthly")
    check("C1 title and button for an upgrade: 'Upgrade to Premium'", up.title === "Upgrade to Premium" && up.button === "Upgrade to Premium", JSON.stringify(up))
    check("C1 new subscription: 'Upgrade to Plus' / 'Continue to secure checkout'",
      JSON.stringify(upgradePageCopy(planChange(null, { tier: "PREMIUM", billing: "monthly" }), "Plus", "monthly")) === JSON.stringify({ title: "Upgrade to Plus", button: "Continue to secure checkout" }))
    const notice = downgradeNotice("Premium", "Plus")
    check("C5 downgrade confirm says it takes effect now with no credit", /right away/.test(notice) && /no credit or refund/.test(notice), notice)

    // What the page sends now: the current plan. Nothing to do, so no Stripe call at all.
    reset(); resetStripe()
    const res = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: sel.tier, billingCycle: sel.billing })))
    const body = await res.json()
    check("C1 same-plan Continue: 'You are already on this plan' and no Stripe call",
      res.status === 200 && body.alreadyOnPlan === true && body.message === "You are already on this plan" && stripeCalls.length === 0,
      `status ${res.status}, body ${JSON.stringify(body)}, Stripe calls ${stripeCalls.map((c) => c.method).join(",")}`)
  }

  console.log("C1. Premium -> Plus downgrade needs confirmDowngrade")
  {
    reset(); resetStripe()
    const res = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: "PREMIUM", billingCycle: "monthly" })))
    const body = await res.json()
    check("C1 downgrade without confirm: 400 with a readable message, subscription untouched",
      res.status === 400 && body.code === "CONFIRM_DOWNGRADE" && /downgrade/i.test(body.error) && callsOf("update").length === 0 &&
      subBy("family_id", "fam-paid")[0].tier === "PREMIUM_PLUS" && stripeSubs.sub_stripe_paid.items.data[0].price.id === "price_prem_m",
      `status ${res.status}, body ${JSON.stringify(body)}, updates ${callsOf("update").length}`)

    const annualDown = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: "PREMIUM", billingCycle: "annual" })))
    check("C1 Premium monthly -> Plus annual is a downgrade too: 400", annualDown.status === 400 && callsOf("update").length === 0)

    const res2 = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: "PREMIUM", billingCycle: "monthly", confirmDowngrade: true })))
    const body2 = await res2.json()
    const upd = callsOf("update")
    check("C1 downgrade with confirmDowngrade: allowed, price -> Plus",
      res2.status === 200 && body2.updated === true && upd.length === 1 && (upd[0].args[1] as Row).items?.[0]?.price === "price_plus_m",
      `status ${res2.status}, body ${JSON.stringify(body2)}`)
    check("C5 downgrade proration: none (no credit; the lower price starts now)",
      (upd[0]?.args[1] as Row)?.proration_behavior === "none")
    check("C1 no Checkout session for a paying family (updated in place instead)", callsOf("create").length === 0)

    // C2: what the confirmation page shows for that URL.
    const url = new URL(String(body2.url))
    const copy = confirmationCopy({ sessionId: url.searchParams.get("session_id"), updated: url.searchParams.get("updated"), tierName: url.searchParams.get("tier") === "PREMIUM" ? "Plus" : null, change: url.searchParams.get("change") })
    check("C2 confirmation for a plan switch: 'Your plan was changed' with the new plan, no payment claimed",
      copy.title === "Your plan was changed" && copy.description.includes("Plus") && !/Payment Successful|processed your payment/.test(JSON.stringify(copy)),
      `url ${body2.url} -> ${JSON.stringify(copy)}`)
    check("C2 'Payment Successful' only with a session_id",
      confirmationCopy({ sessionId: "cs_1" }).title === "Payment Successful!" && confirmationCopy({}).title !== "Payment Successful!" &&
      confirmationCopy({ updated: "1", change: "resume", tierName: "Premium" }).title === "Your plan will continue")
  }

  console.log("C4. Plus -> Premium upgrade on the same interval")
  {
    reset(); resetStripe()
    stripeSubs.sub_stripe_paid.items.data[0].price = PRICES.price_plus_m
    subs[1].tier = "PREMIUM"; subs[1].stripe_price_id = "price_plus_m"
    const res = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: "PREMIUM_PLUS", billingCycle: "monthly" })))
    const url = String((await res.json()).url)
    check("C4 confirmation says upgrade (difference charged now)", url.includes("change=upgrade&") || url.endsWith("change=upgrade"), url)
    const p = callsOf("update")[0]?.args[1] as Row
    check("C4 upgrade invoices the difference now and refuses on card failure (no confirm needed)",
      p?.proration_behavior === "always_invoice" && p?.payment_behavior === "error_if_incomplete")
  }

  console.log("C6. monthly -> annual switch")
  {
    reset(); resetStripe()
    const res = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: "PREMIUM_PLUS", billingCycle: "annual" })))
    const url = String((await res.json()).url)
    const p = callsOf("update")[0]?.args[1] as Row
    check("C6 interval switch: no proration (annual price from the next invoice), no downgrade confirm needed", res.status === 200 && p?.proration_behavior === "none" && p?.items?.[0]?.price === "price_prem_y")
    check("C6 confirmation says billing switch", url.endsWith("change=billing"), url)

    reset(); resetStripe()
    stripeSubs.sub_stripe_paid.items.data[0].price = PRICES.price_plus_y
    subs[1].tier = "PREMIUM"; subs[1].stripe_price_id = "price_plus_y"
    const r2 = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: "PREMIUM_PLUS", billingCycle: "monthly" })))
    const url2 = String((await r2.json()).url)
    check("C6 Plus annual -> Premium monthly: an upgrade, new price at the next bill (not 'difference charged')",
      r2.status === 200 && url2.endsWith("change=upgrade_next_bill") && /next bill/.test(confirmationCopy({ updated: "1", change: "upgrade_next_bill", tierName: "Premium" }).body), url2)
  }

  console.log("B8. promo code on a plan switch")
  {
    reset(); resetStripe()
    stub(s.promotionCodes, "list", () => ({
      data: [{ id: "promo_t50", code: "TEST50", active: true, created: 1, expires_at: null, max_redemptions: 1, times_redeemed: 0, metadata: { appliesTo: "ALL" }, restrictions: {}, promotion: { type: "coupon", coupon: { id: "co", valid: true, percent_off: 50, amount_off: null, duration: "once", duration_in_months: null } } }],
    }))
    const res = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_PAID, { familyId: "fam-paid", tier: "PREMIUM_PLUS", billingCycle: "annual", promoCode: "TEST50" })))
    check("B8 code on a plan switch: 400 and the subscription is not touched", res.status === 400 && callsOf("update").length === 0)

    reset(); resetStripe()
    stub(s.promotionCodes, "list", () => ({
      data: [{ id: "promo_t50", code: "TEST50", active: true, created: 1, expires_at: null, max_redemptions: 1, times_redeemed: 0, metadata: { appliesTo: "ALL" }, restrictions: {}, promotion: { type: "coupon", coupon: { id: "co", valid: true, percent_off: 50, amount_off: null, duration: "once", duration_in_months: null } } }],
    }))
    const r2 = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_FREE, { familyId: "fam-free", tier: "PREMIUM", billingCycle: "monthly", promoCode: "test50" })))
    const sessionParams = callsOf("create").map((c) => c.args[0] as Row).find((p) => p?.mode === "subscription")
    check("B1 new subscription with TEST50: Checkout gets discounts [promo_t50] and no allow_promotion_codes",
      r2.status === 200 && JSON.stringify(sessionParams?.discounts) === JSON.stringify([{ promotion_code: "promo_t50" }]) && !("allow_promotion_codes" in (sessionParams ?? {})))
    stub(s.promotionCodes, "list", () => ({ data: [] }))
  }

  console.log("B4. promo check endpoint")
  {
    const r = await quiet(() => promoCheck.POST(post("/api/subscription/promo-check", OWNER_FREE, { code: "NOPE", tier: "PREMIUM", billingCycle: "monthly" })))
    const b = await r.json()
    check("B4 unknown code: 200 with a readable error", r.status === 200 && b.error === "That promo code isn't valid.")
    const r2 = await quiet(() => promoCheck.POST(post("/api/subscription/promo-check", OWNER_FREE, { code: "NOPE", tier: "PREMIUM", billingCycle: "monthly" }, { referer: "android-app://com.togethrapp.mobile/" })))
    check("H4 promo check refused inside the Android app", r2.status === 403)
  }

  // ===== H. who may pay ===============================================================
  console.log("H2/H3. forged familyId, co-parent, child")
  {
    reset(); resetStripe()
    const tries: [string, Promise<Response>][] = [
      ["checkout stranger", quiet(() => checkout.POST(post("/api/subscription/checkout", STRANGER, { familyId: "fam-paid", tier: "PREMIUM", billingCycle: "monthly" })))],
      ["checkout co-parent", quiet(() => checkout.POST(post("/api/subscription/checkout", COPARENT, { familyId: "fam-paid", tier: "PREMIUM", billingCycle: "monthly" })))],
      ["checkout child", quiet(() => checkout.POST(post("/api/subscription/checkout", CHILD, { familyId: "fam-free", tier: "PREMIUM", billingCycle: "monthly" })))],
      ["portal stranger", quiet(() => portal.POST(post("/api/subscription/portal", STRANGER, { familyId: "fam-paid" })))],
      ["portal co-parent", quiet(() => portal.POST(post("/api/subscription/portal", COPARENT, { familyId: "fam-paid" })))],
      ["resume stranger", quiet(() => resume.POST(post("/api/subscription/resume", STRANGER, { familyId: "fam-paid" })))],
    ]
    const statuses: string[] = []
    for (const [name, p] of tries) statuses.push(`${name}=${(await p).status}`)
    check("H2/H3 only the owner gets checkout, portal or resume (403/401 for everyone else, no Stripe writes)",
      statuses.every((x) => /=(401|403)$/.test(x)) && callsOf("update").length === 0 && callsOf("create").length === 0, statuses.join(", "))
    const android = await quiet(() => checkout.POST(post("/api/subscription/checkout", OWNER_FREE, { familyId: "fam-free", tier: "PREMIUM", billingCycle: "monthly" }, { cookie: "togethr_android=1" })))
    check("H4 checkout refused inside the Android app", android.status === 403)
  }

  // ===== admin =========================================================================
  console.log("C3. admin 'grant trial' on a family paying through Stripe")
  {
    reset(); resetStripe()
    stripeSubs.sub_stripe_paid.items.data[0].price = PRICES.price_plus_m
    subs[1].tier = "PREMIUM"; subs[1].stripe_price_id = "price_plus_m"
    const req = new NextRequest("http://localhost:3000/api/admin/subscriptions/sub-paid", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: "grant_trial", trialDays: 7, reason: "test" }),
    })
    const grant = (subscriptionId: string) => quiet(() => adminSub.PATCH(
      new NextRequest(`http://localhost:3000/api/admin/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "grant_trial", trialDays: 7, reason: "test" }),
      }),
      { params: Promise.resolve({ subscriptionId }) }
    ))
    const stripeMsg = "This family has a Stripe subscription. Use Change tier or a Stripe coupon instead."
    const res = await quiet(() => adminSub.PATCH(req, { params: Promise.resolve({ subscriptionId: "sub-paid" }) }))
    const b = await res.json()
    const row = subBy("id", "sub-paid")[0]
    check("C3 admin grant_trial on an ACTIVE Stripe family: 409, row untouched",
      res.status === 409 && b.error === stripeMsg && row.tier === "PREMIUM" && row.status === "ACTIVE" && history.length === 0,
      `status ${res.status}, error ${b.error}, DB ${row.tier}/${row.status}`)

    subBy("id", "sub-paid")[0].status = "PAST_DUE"
    const r2 = await grant("sub-paid")
    check("C3 admin grant_trial on a PAST_DUE Stripe family: 409, row untouched",
      r2.status === 409 && subBy("id", "sub-paid")[0].status === "PAST_DUE" && subBy("id", "sub-paid")[0].tier === "PREMIUM")

    subBy("id", "sub-paid")[0].status = "CANCELLED"
    const r3 = await grant("sub-paid")
    check("C3 admin grant_trial after the Stripe subscription is cancelled: allowed", r3.status === 200 && subBy("id", "sub-paid")[0].status === "TRIALING")

    reset()
    const r4 = await grant("sub-free")
    check("C3 admin grant_trial on a Free family (no Stripe): allowed", r4.status === 200 && subBy("id", "sub-free")[0].status === "TRIALING")
  }

  console.log("C3. self-service 'Start trial' on a family paying through Stripe")
  {
    const start = () => quiet(() => familySub.POST(
      post("/api/subscriptions/fam-paid", OWNER_PAID, { action: "start_trial", tier: "PREMIUM_PLUS" }),
      { params: Promise.resolve({ familyId: "fam-paid" }) }
    ))
    const stripeMsg = "This family has a Stripe subscription. Use Change tier or a Stripe coupon instead."
    for (const status of ["PAST_DUE", "ACTIVE"]) {
      reset()
      subs[1].status = status
      const res = await start()
      const b = await res.json()
      const row = subBy("id", "sub-paid")[0]
      check(`C3 start_trial on a ${status} Stripe family: 409, row untouched`,
        res.status === 409 && b.error === stripeMsg && row.status === status && row.tier === "PREMIUM_PLUS" && history.length === 0,
        `status ${res.status}, error ${b.error}, DB ${row.tier}/${row.status}`)
    }
    reset()
    subs[1].status = "CANCELLED"; subs[1].tier = "FREE"
    const ok = await start()
    check("C3 start_trial after the Stripe subscription is cancelled: allowed", ok.status === 200 && subBy("id", "sub-paid")[0].status === "TRIALING", `status ${ok.status}`)
  }

  console.log("B9. admin creates a promo code with a key that can't write coupons")
  {
    const req = new NextRequest("http://localhost:3000/api/admin/promo-codes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ code: "TEST50", kind: "percent", value: 50, duration: "once", maxRedemptions: 1, firstTimeOnly: true }),
    })
    const res = await quiet(() => adminPromo.POST(req))
    const b = await res.json()
    check("B9 missing coupon permission: 403 with what to fix, no key prefix or account id",
      res.status === 403 &&
      b.error === "Stripe key can't create promo codes. In Stripe, give the restricted key Coupons: Write and Promotion codes: Write." &&
      !/rk_live|acct_/.test(JSON.stringify(b)),
      `status ${res.status}, error: ${b.error}`)
    const { promoStripeError } = await import("../lib/promo-codes")
    const other = promoStripeError(Object.assign(new Error("Invalid API Key provided: sk_live_****abcd on account acct_123ABC"), { type: "StripeAuthenticationError" }), "x")
    check("B9 any other Stripe error never echoes a key or account id", other.status === 502 && !/sk_live|acct_1/.test(other.error), other.error)
    const res2 = await quiet(() => adminPromo.POST(new NextRequest("http://localhost:3000/api/admin/promo-codes", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokens[OWNER_PAID]}` }, body: "{}",
    })))
    check("H5 a normal user's token can't create promo codes", res2.status === 401)
  }

  console.log(`\n${results.filter((r) => r.pass).length} passed, ${results.filter((r) => !r.pass).length} failed`)
  assert.ok(results.length > 0)
  if (results.some((r) => !r.pass)) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
