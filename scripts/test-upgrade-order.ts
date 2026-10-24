// Usage: npx tsx --tsconfig tsconfig.json scripts/test-upgrade-order.ts
// The upgrade page's order summary (lib/upgrade-order.ts) and its ?tier= /
// &billing= parsing, plus the pricing copy rules: no tax wording until Stripe
// Tax is on, texts shown as "coming soon". Pure logic: no database, no network.
import assert from "node:assert"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  delete process.env.NEXT_PUBLIC_STRIPE_TAX_ENABLED
  const { parseUpgradeParams, orderSummaryCents, centsToDollars } = await import("../lib/upgrade-order")
  const { SUBSCRIPTION_TIERS, priceTaxNote, TEXT_ALERTS_SOON } = await import("../lib/subscription-tiers")

  // --- order summary (the prices themselves are not changed) ---
  assert.equal(SUBSCRIPTION_TIERS.PREMIUM.priceMonthlyCents, 599)
  assert.equal(SUBSCRIPTION_TIERS.PREMIUM.priceAnnualCents, 5990)
  assert.equal(SUBSCRIPTION_TIERS.PREMIUM_PLUS.priceMonthlyCents, 999)
  assert.equal(SUBSCRIPTION_TIERS.PREMIUM_PLUS.priceAnnualCents, 9990)
  ok("prices unchanged: Plus $5.99/$59.90, Premium $9.99/$99.90")

  const show = (s: { listCents: number; discountCents: number; totalCents: number }) =>
    [s.listCents, s.discountCents, s.totalCents].map(centsToDollars).join(" ")
  assert.equal(show(orderSummaryCents("PREMIUM", "annual")), "$71.88 $11.98 $59.90")
  assert.equal(show(orderSummaryCents("PREMIUM_PLUS", "annual")), "$119.88 $19.98 $99.90")
  ok("annual: 12 x monthly, minus the discount, equals the total (Plus and Premium)")

  assert.equal(show(orderSummaryCents("PREMIUM", "monthly")), "$5.99 $0.00 $5.99")
  assert.equal(show(orderSummaryCents("PREMIUM_PLUS", "monthly")), "$9.99 $0.00 $9.99")
  for (const t of ["PREMIUM", "PREMIUM_PLUS"] as const) {
    for (const b of ["monthly", "annual"] as const) {
      const s = orderSummaryCents(t, b)
      assert.equal(s.listCents - s.discountCents, s.totalCents)
    }
  }
  ok("monthly: no discount line; list - discount = total for all four")

  // --- ?tier= / &billing= ---
  const p = (t: string | null, b: string | null) => { const r = parseUpgradeParams(t, b); return `${r.tier}/${r.billing}` }
  assert.equal(p("PREMIUM_PLUS", "annual"), "PREMIUM_PLUS/annual")
  assert.equal(p("premium_plus", "ANNUAL"), "PREMIUM_PLUS/annual")
  assert.equal(p("Premium Plus", "yearly"), "PREMIUM_PLUS/annual")
  assert.equal(p("PREMIUM", "monthly"), "PREMIUM/monthly")
  assert.equal(p("premium", "Monthly"), "PREMIUM/monthly", "PREMIUM is the Plus plan's key")
  assert.equal(p("plus", "annual"), "PREMIUM/annual")
  ok("tier and billing read case-insensitively (PREMIUM = Plus, PREMIUM_PLUS = Premium)")

  assert.equal(p(null, null), "PREMIUM/monthly")
  assert.equal(p("", ""), "PREMIUM/monthly")
  assert.equal(p("FREE", "weekly"), "PREMIUM/monthly")
  assert.equal(p("<script>", "annual"), "PREMIUM/annual")
  ok("absent or invalid: Plus / monthly")

  // --- copy ---
  assert.equal(priceTaxNote(), "", "no tax wording while Stripe Tax is off")
  process.env.NEXT_PUBLIC_STRIPE_TAX_ENABLED = "true"
  assert.equal(priceTaxNote(), "Taxes calculated at checkout")
  delete process.env.NEXT_PUBLIC_STRIPE_TAX_ENABLED
  ok("tax note only when STRIPE_TAX_ENABLED is true")

  for (const t of [SUBSCRIPTION_TIERS.PREMIUM, SUBSCRIPTION_TIERS.PREMIUM_PLUS]) {
    assert.ok(t.featureList.includes(TEXT_ALERTS_SOON))
    assert.ok(!t.featureList.some((f) => /\d+ text alerts/.test(f)))
    assert.ok(t.limits.smsMonthlyQuota > 0, "the quota itself is kept")
  }
  assert.equal(SUBSCRIPTION_TIERS.PREMIUM.limits.smsMonthlyQuota, 25)
  assert.equal(SUBSCRIPTION_TIERS.PREMIUM_PLUS.limits.smsMonthlyQuota, 100)
  ok('plan bullets say "Text alerts (coming soon)"; quotas 25/100 kept in code')

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
