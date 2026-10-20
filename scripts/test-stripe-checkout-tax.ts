// Usage: npx tsx --tsconfig tsconfig.json scripts/test-stripe-checkout-tax.ts
// Checkout Session params with STRIPE_TAX_ENABLED off (exactly the pre-tax
// session) and on. Pure function, no Stripe calls.
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { buildCheckoutSessionParams, subscriptionUpdateTaxParams, stripeTaxEnabled } from "../lib/stripe-checkout"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const opts = {
  customerId: "cus_test",
  priceId: "price_test",
  familyId: "fam-1",
  tier: "premium",
  billingCycle: "monthly",
  userId: "user-1",
  appUrl: "https://example.test",
  randomSuffix: "abcdefgh",
}

// The session as checkout/route.ts built it before Stripe Tax existed.
const meta = { familyId: "fam-1", requestedTier: "PREMIUM", billingCycle: "monthly", requestedBy: "user-1" }
const BEFORE = {
  mode: "subscription",
  customer: "cus_test",
  line_items: [{ price: "price_test", quantity: 1 }],
  subscription_data: { metadata: meta },
  metadata: meta,
  integration_identifier: "togethr_abcdefgh",
  success_url: "https://example.test/subscription/confirmation?session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://example.test/subscription/upgrade?tier=premium",
}

for (const v of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
  if (v === undefined) delete process.env.STRIPE_TAX_ENABLED
  else process.env.STRIPE_TAX_ENABLED = v
  const p = buildCheckoutSessionParams(opts)
  assert.strictEqual(stripeTaxEnabled(), false, `flag ${JSON.stringify(v)} is off`)
  assert.deepStrictEqual(p, BEFORE, `flag ${JSON.stringify(v)}: session identical to today's`)
  assert.ok(!("automatic_tax" in p) && !("billing_address_collection" in p) && !("customer_update" in p))
  assert.deepStrictEqual(subscriptionUpdateTaxParams(), {})
}
ok("flag unset / not exactly \"true\": session identical to today's, no automatic_tax")

process.env.STRIPE_TAX_ENABLED = "true"
{
  const p = buildCheckoutSessionParams(opts)
  assert.deepStrictEqual(p.automatic_tax, { enabled: true })
  assert.strictEqual(p.billing_address_collection, "required")
  assert.deepStrictEqual(p.customer_update, { address: "auto", name: "auto" })
  assert.deepStrictEqual(p.tax_id_collection, { enabled: false })
  const { automatic_tax, billing_address_collection, customer_update, tax_id_collection, ...rest } = p
  assert.deepStrictEqual(rest, BEFORE, "nothing else changes")
  assert.deepStrictEqual(subscriptionUpdateTaxParams(), { automatic_tax: { enabled: true } })
}
ok("flag \"true\": automatic_tax, required billing address, customer_update, tax IDs off; plan switch gets automatic_tax")

for (const v of [undefined, "true"]) {
  if (v === undefined) delete process.env.STRIPE_TAX_ENABLED
  else process.env.STRIPE_TAX_ENABLED = v
  assert.ok(!("payment_method_types" in buildCheckoutSessionParams(opts)))
}
ok("never sets payment_method_types, flag on or off")

// Prices are tax-inclusive in the Stripe Dashboard: code must never set
// tax_behavior (or create prices) anywhere, flag on or off.
{
  const hasTaxBehavior = (x: unknown): boolean =>
    !!x && typeof x === "object" && Object.entries(x as Record<string, unknown>).some(([k, v]) => k === "tax_behavior" || hasTaxBehavior(v))
  for (const v of [undefined, "true"]) {
    if (v === undefined) delete process.env.STRIPE_TAX_ENABLED
    else process.env.STRIPE_TAX_ENABLED = v
    assert.ok(!hasTaxBehavior(buildCheckoutSessionParams(opts)), "no tax_behavior in session params")
    assert.ok(!hasTaxBehavior(subscriptionUpdateTaxParams()), "no tax_behavior in plan-switch params")
  }
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
    }
  }
  for (const d of ["app", "lib", "components", "hooks"]) walk(path.join(process.cwd(), d))
  const offenders = files.filter((f) => /tax_behavior|prices\.create/.test(fs.readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")))
  assert.deepStrictEqual(offenders, [], "tax_behavior / prices.create must not appear in app code")
}
ok("no tax_behavior set in code (session, plan switch, and a scan of app/lib/components/hooks)")

console.log(`\nAll ${passed} checkout tax checks passed.`)
