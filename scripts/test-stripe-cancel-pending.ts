// Usage: npx tsx --tsconfig tsconfig.json scripts/test-stripe-cancel-pending.ts
// A cancellation made in the Stripe customer portal (lib/stripe-cancel.ts):
// customer.subscription.updated through the real webhook route saves the
// pending cancel and its end date, resuming clears them, and the Resume
// route sends Stripe the right update. In-memory fake database and fake
// Stripe calls: DATABASE_URL points at a closed local port and the Stripe
// key is a placeholder, so nothing real is touched.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_never_called"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_webhook_secret_not_real"
process.env.JWT_ACCESS_SECRET = "cancel-pending-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "cancel-pending-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "cancel-pending-test-placeholder-not-used"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, unknown>

const FAMILY = "fam_1"
const OWNER = "u-owner"
const PERIOD_END = 1793836800 // 2026-11-05T00:00:00Z
const iso = (s: number) => new Date(s * 1000).toISOString()

async function main() {
  const { NextRequest } = await import("next/server")
  const { __setSqlForTests } = await import("../lib/db")
  const { stripe } = await import("../lib/stripe")
  const { generateAccessToken } = await import("../lib/auth")
  const { pendingCancelFrom, resumeParams } = await import("../lib/stripe-cancel")
  const webhook = await import("../app/api/webhooks/stripe/route")
  const resumeRoute = await import("../app/api/subscription/resume/route")

  // ---- fake database: one Plus subscription row ---------------------------------------
  const row: Row = {
    id: "subrow_1", family_id: FAMILY, tier: "PREMIUM", status: "ACTIVE", stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1", cancel_at_period_end: false, cancel_at: null,
  }
  const writes: string[] = []
  // The value bound right after "<column> =" in an UPDATE.
  const bound = (strings: TemplateStringsArray, v: unknown[], column: string) => {
    const i = strings.findIndex((s) => s.trimEnd().endsWith(`${column} =`))
    return i >= 0 ? v[i] : undefined
  }
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (/^(UPDATE|INSERT|DELETE)/.test(q)) writes.push(q)
    if (q.startsWith("WITH u AS")) {
      return [{ id: v[0], email: "owner@example.invalid", first_name: "Owner", last_name: "", is_active: true,
        member_id: "m-owner", role: "PARENT", family_id: FAMILY, family_name: "Testers", owner_id: OWNER }]
    }
    if (q.startsWith("SELECT * FROM subscriptions")) return [{ ...row }]
    if (q.startsWith("SELECT fm.role, f.owner_id")) return [{ role: "PARENT", owner_id: OWNER }]
    if (q.startsWith("SELECT stripe_subscription_id FROM subscriptions")) return [{ stripe_subscription_id: row.stripe_subscription_id }]
    if (q.startsWith("UPDATE subscriptions SET tier") || q.startsWith("UPDATE subscriptions SET cancel_at_period_end")) {
      const pending = bound(strings, v, "cancel_at_period_end")
      if (pending !== undefined) row.cancel_at_period_end = pending
      else if (q.includes("cancel_at_period_end = false")) row.cancel_at_period_end = false
      if (q.includes("cancel_at = NULL")) row.cancel_at = null
      else {
        const at = bound(strings, v, "cancel_at")
        if (at !== undefined) row.cancel_at = at
      }
      if (q.includes("status = 'CANCELLED'")) { row.status = "CANCELLED"; row.tier = "FREE"; row.cancel_at_period_end = false }
      return []
    }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  // ---- fake Stripe calls -------------------------------------------------------------------
  let live: Row = {}
  const updates: Row[] = []
  ;(stripe.subscriptions as unknown as { retrieve: unknown }).retrieve = async () => live
  ;(stripe.subscriptions as unknown as { update: unknown }).update = async (_id: string, params: Row) => { updates.push(params); return live }

  const secret = process.env.STRIPE_WEBHOOK_SECRET!
  const subObject = (extra: Row) => ({
    id: "sub_1", object: "subscription", customer: "cus_1", status: "active", metadata: { familyId: FAMILY },
    cancel_at: null, cancel_at_period_end: false, trial_end: null,
    items: { data: [{ price: { id: "price_unknown" }, current_period_start: PERIOD_END - 30 * 86400, current_period_end: PERIOD_END }] },
    ...extra,
  })
  const send = async (type: string, object: Row) => {
    const payload = JSON.stringify({ id: `evt_${Math.random()}`, object: "event", type, livemode: false, created: 1760000000, api_version: "2026-08-26.dahlia", data: { object } })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    return webhook.POST(new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload }))
  }

  // 1. Detecting a pending cancel, both billing modes.
  const flexible = subObject({ cancel_at: PERIOD_END, cancel_at_period_end: false })
  const classic = subObject({ cancel_at: PERIOD_END, cancel_at_period_end: true })
  assert.deepStrictEqual(pendingCancelFrom(flexible as never), { pending: true, endsAt: iso(PERIOD_END) })
  assert.deepStrictEqual(pendingCancelFrom(classic as never), { pending: true, endsAt: iso(PERIOD_END) })
  assert.deepStrictEqual(pendingCancelFrom(subObject({ cancel_at_period_end: true }) as never), { pending: true, endsAt: iso(PERIOD_END) })
  assert.deepStrictEqual(pendingCancelFrom(subObject({}) as never), { pending: false, endsAt: null })
  assert.deepStrictEqual(pendingCancelFrom(subObject({ status: "canceled", cancel_at: PERIOD_END }) as never), { pending: false, endsAt: null })
  assert.deepStrictEqual(resumeParams(flexible as never), { cancel_at: "" })
  assert.deepStrictEqual(resumeParams(classic as never), { cancel_at_period_end: false })
  assert.strictEqual(resumeParams(subObject({}) as never), null)
  ok("pending cancel read from cancel_at (portal, flexible) and cancel_at_period_end (classic)")

  // 2. Portal cancel (flexible: only cancel_at) -> saved as pending with its end date.
  let res = await send("customer.subscription.updated", flexible)
  assert.strictEqual(res.status, 200)
  assert.strictEqual(row.cancel_at_period_end, true)
  assert.strictEqual(row.cancel_at, iso(PERIOD_END))
  assert.strictEqual(row.tier, "PREMIUM", "still Plus until the end date")
  assert.strictEqual(row.status, "ACTIVE")
  ok("customer.subscription.updated with cancel_at: pending saved with the end date, plan unchanged")

  // 3. Resumed in the portal -> cleared.
  res = await send("customer.subscription.updated", subObject({}))
  assert.strictEqual(res.status, 200)
  assert.strictEqual(row.cancel_at_period_end, false)
  assert.strictEqual(row.cancel_at, null)
  ok("resumed in the portal: pending cleared")

  // 4. Classic mode cancel at period end is saved too.
  await send("customer.subscription.updated", classic)
  assert.strictEqual(row.cancel_at_period_end, true)
  assert.strictEqual(row.cancel_at, iso(PERIOD_END))
  ok("classic cancel_at_period_end: pending saved")

  // 5. Resume button: owner's request sends Stripe the update for the mode in use, row cleared.
  const token = await generateAccessToken(OWNER)
  const resume = () => resumeRoute.POST(new NextRequest("http://localhost/api/subscription/resume", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ familyId: FAMILY }),
  }))
  live = classic
  let resumed = await resume()
  assert.strictEqual(resumed.status, 200)
  assert.deepStrictEqual(updates.pop(), { cancel_at_period_end: false })
  assert.strictEqual(row.cancel_at_period_end, false)
  assert.strictEqual(row.cancel_at, null)
  row.cancel_at_period_end = true
  live = flexible
  resumed = await resume()
  assert.strictEqual(resumed.status, 200)
  assert.deepStrictEqual(updates.pop(), { cancel_at: "" })
  assert.strictEqual(row.cancel_at_period_end, false)
  ok("Resume: classic clears cancel_at_period_end, flexible clears cancel_at; row updated at once")

  // 6. Resume from inside the Android app is refused, like the billing portal.
  const inApp = await resumeRoute.POST(new NextRequest("http://localhost/api/subscription/resume", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, cookie: "togethr_android=1" }, body: JSON.stringify({ familyId: FAMILY }),
  }))
  assert.strictEqual(inApp.status, 403)
  ok("Resume refused inside the Android app")

  // 7. The plan really ends -> Free, pending cleared.
  row.cancel_at_period_end = true
  row.cancel_at = iso(PERIOD_END)
  await send("customer.subscription.deleted", subObject({ status: "canceled" }))
  assert.strictEqual(row.tier, "FREE")
  assert.strictEqual(row.status, "CANCELLED")
  assert.strictEqual(row.cancel_at_period_end, false)
  assert.strictEqual(row.cancel_at, null)
  ok("customer.subscription.deleted: Free, pending cleared")

  __setSqlForTests(null)
  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
