// Usage: npx tsx --tsconfig tsconfig.json scripts/test-promo-codes.ts
// Promo codes (lib/promo-codes.ts): code format, the admin form's checks,
// the Stripe Coupon / Promotion Code params, the wording and amounts the
// upgrade page shows, the lookup against a fake Stripe, and Checkout's
// discounts vs Stripe's own promo field. No database, no Stripe calls.
import assert from "node:assert"
import type Stripe from "stripe"
import {
  couponParamsFor,
  describeDiscount,
  discountCents,
  expiresAtFor,
  findUsablePromoCode,
  normalizePromoCode,
  promoCodeRow,
  promoCreateSchema,
  promotionCodeParamsFor,
} from "../lib/promo-codes"
import { buildCheckoutSessionParams } from "../lib/stripe-checkout"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  assert.equal(normalizePromoCode(" launch 20 "), "LAUNCH20")
  assert.equal(normalizePromoCode("fall_sale-1"), "FALL_SALE-1")
  assert.equal(normalizePromoCode("ab"), null)
  assert.equal(normalizePromoCode("x".repeat(31)), null)
  assert.equal(normalizePromoCode("50%OFF"), null)
  assert.equal(normalizePromoCode(42), null)
  ok("codes: 3-30 letters, digits, - or _, upper-cased")

  const parse = (v: object) => promoCreateSchema.safeParse({ code: "LAUNCH20", kind: "percent", value: 20, duration: "once", ...v })
  assert.ok(parse({}).success)
  assert.equal(parse({}).data?.appliesTo, "ALL")
  assert.equal(parse({}).data?.firstTimeOnly, false)
  assert.ok(!parse({ value: 101 }).success, "over 100%")
  assert.ok(!parse({ value: 0 }).success)
  assert.ok(!parse({ duration: "repeating" }).success, "repeating needs months")
  assert.ok(parse({ duration: "repeating", months: 3 }).success)
  assert.ok(!parse({ duration: "repeating", months: 37 }).success)
  assert.ok(!parse({ code: "no!" }).success)
  assert.ok(parse({ kind: "amount", value: 4.99 }).success)
  assert.ok(!parse({ kind: "amount", value: 0.001 }).success)
  assert.ok(!parse({ expiresOn: "12/31/2026" }).success)
  ok("admin form: percent 1-100, months for repeating, valid code and date")

  const now = Date.parse("2026-11-04T12:00:00Z")
  assert.equal(expiresAtFor(undefined, now), undefined)
  assert.equal(expiresAtFor("2026-11-04", now), Date.parse("2026-11-04T23:59:59Z") / 1000, "end of that day")
  assert.equal(expiresAtFor("2026-11-03", now), null, "past day refused")
  ok("last day: end of that UTC day, past days refused")

  const pct = parse({ duration: "repeating", months: 3, appliesTo: "PREMIUM", maxRedemptions: 50, firstTimeOnly: true }).data!
  assert.deepStrictEqual(couponParamsFor(pct, ["prod_plus"]), {
    name: "LAUNCH20",
    duration: "repeating",
    duration_in_months: 3,
    percent_off: 20,
    applies_to: { products: ["prod_plus"] },
    metadata: { source: "togethr-admin" },
  })
  const amt = parse({ kind: "amount", value: 5, duration: "forever" }).data!
  assert.deepStrictEqual(couponParamsFor(amt, []), {
    name: "LAUNCH20",
    duration: "forever",
    amount_off: 500,
    currency: "usd",
    metadata: { source: "togethr-admin" },
  })
  assert.deepStrictEqual(promotionCodeParamsFor(pct, "co_1", "admin-1", 1800000000), {
    promotion: { type: "coupon", coupon: "co_1" },
    code: "LAUNCH20",
    max_redemptions: 50,
    expires_at: 1800000000,
    restrictions: { first_time_transaction: true },
    metadata: { createdByAdmin: "admin-1", appliesTo: "PREMIUM" },
  })
  assert.deepStrictEqual(promotionCodeParamsFor(amt, "co_2", "admin-1", undefined), {
    promotion: { type: "coupon", coupon: "co_2" },
    code: "LAUNCH20",
    metadata: { createdByAdmin: "admin-1", appliesTo: "ALL" },
  })
  ok("Stripe params: coupon (percent / dollars, months, plan products) and promotion code (limits, end, first purchase)")

  const d = (o: object) => ({ percentOff: null, amountOffCents: null, duration: "forever", durationInMonths: null, ...o })
  assert.equal(describeDiscount(d({ percentOff: 20, duration: "repeating", durationInMonths: 3 })), "20% off for 3 months")
  assert.equal(describeDiscount(d({ percentOff: 50, duration: "repeating", durationInMonths: 1 })), "50% off for 1 month")
  assert.equal(describeDiscount(d({ amountOffCents: 500, duration: "once" })), "$5.00 off the first payment")
  assert.equal(describeDiscount(d({ percentOff: 10 })), "10% off")
  assert.equal(discountCents(d({ percentOff: 20 }), 999), 200)
  assert.equal(discountCents(d({ amountOffCents: 2000 }), 999), 999, "never below zero")
  assert.equal(discountCents(d({ amountOffCents: 500 }), 999), 500)
  ok("wording and first-payment amounts")

  const coupon = (o: Partial<Stripe.Coupon> = {}) =>
    ({ id: "co_1", valid: true, percent_off: 20, amount_off: null, duration: "once", duration_in_months: null, ...o }) as Stripe.Coupon
  const promo = (o: Partial<Stripe.PromotionCode> = {}, c: Stripe.Coupon | string | null = coupon()) =>
    ({
      id: "promo_1", code: "LAUNCH20", active: true, created: 1790000000, expires_at: null, max_redemptions: null,
      times_redeemed: 0, metadata: { appliesTo: "ALL" }, restrictions: {}, promotion: { type: "coupon", coupon: c }, ...o,
    }) as unknown as Stripe.PromotionCode
  const fake = (rows: Stripe.PromotionCode[]) => {
    const calls: Stripe.PromotionCodeListParams[] = []
    return {
      calls,
      promotionCodes: { list: async (p: Stripe.PromotionCodeListParams) => { calls.push(p); return { data: rows } } },
    }
  }
  const plus = { tier: "PREMIUM" as const, productId: "prod_plus" }

  const s1 = fake([promo()])
  const found = await findUsablePromoCode(s1, " launch20 ", plus, now)
  assert.deepStrictEqual(found, {
    ok: true, promotionCodeId: "promo_1", code: "LAUNCH20",
    discount: { percentOff: 20, amountOffCents: null, duration: "once", durationInMonths: null },
  })
  assert.deepStrictEqual(s1.calls[0], { code: "LAUNCH20", active: true, limit: 1, expand: ["data.promotion.coupon.applies_to"] })

  const err = async (rows: Stripe.PromotionCode[], plan = plus, raw: unknown = "LAUNCH20") => {
    const r = await findUsablePromoCode(fake(rows), raw, plan, now)
    assert.ok(!r.ok)
    return r.error
  }
  assert.equal(await err([]), "That promo code isn't valid.")
  assert.equal(await err([promo()], plus, "!!"), "That promo code isn't valid.")
  assert.equal(await err([promo({ expires_at: now / 1000 - 1 })]), "That promo code has expired.")
  assert.equal(await err([promo({ max_redemptions: 5, times_redeemed: 5 })]), "That promo code has been used up.")
  assert.equal(await err([promo({}, coupon({ valid: false }))]), "That promo code isn't valid.")
  assert.equal(await err([promo({}, "co_1")]), "That promo code isn't valid.", "coupon not expanded")
  assert.equal(
    await err([promo({}, coupon({ applies_to: { products: ["prod_premium"] } }))]),
    "That promo code doesn't apply to this plan."
  )
  assert.equal(
    await err([promo({ metadata: { appliesTo: "PREMIUM_PLUS" } })]),
    "That promo code doesn't apply to this plan."
  )
  assert.ok((await findUsablePromoCode(fake([promo({}, coupon({ applies_to: { products: ["prod_plus"] } }))]), "LAUNCH20", plus, now)).ok)
  assert.ok((await findUsablePromoCode(fake([promo({ max_redemptions: 5, times_redeemed: 4 })]), "LAUNCH20", plus, now)).ok)
  ok("lookup: active code; expired, used up, invalid coupon and other-plan codes refused")

  const row = promoCodeRow(promo({ max_redemptions: 50, times_redeemed: 3, expires_at: 1800000000, restrictions: { first_time_transaction: true } as Stripe.PromotionCode.Restrictions }))
  assert.equal(row.description, "20% off the first payment")
  assert.equal(row.timesRedeemed, 3)
  assert.equal(row.maxRedemptions, 50)
  assert.equal(row.firstTimeOnly, true)
  assert.equal(row.expiresAt, new Date(1800000000 * 1000).toISOString())
  ok("admin list row")

  const opts = {
    customerId: "cus_test", priceId: "price_test", familyId: "fam-1", tier: "premium", billingCycle: "monthly",
    userId: "user-1", appUrl: "https://example.test", randomSuffix: "abcdefgh",
  }
  const plain = buildCheckoutSessionParams(opts)
  assert.strictEqual(plain.allow_promotion_codes, true)
  assert.ok(!("discounts" in plain))
  const withCode = buildCheckoutSessionParams({ ...opts, promotionCodeId: "promo_1" })
  assert.deepStrictEqual(withCode.discounts, [{ promotion_code: "promo_1" }])
  assert.ok(!("allow_promotion_codes" in withCode), "Stripe refuses both together")
  ok("Checkout: a code from our page is applied; otherwise Stripe's own promo field")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
