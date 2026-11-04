import type Stripe from "stripe"
import { z } from "zod"
import { normalizePromoCode } from "./promo-code-format"
import { describeDiscount, discountOf, type PromoDiscount } from "./promo-discount"

// Promo codes for subscriptions. Stripe holds them: each code is a Stripe
// Promotion Code on its own Coupon, so Stripe enforces the discount,
// redemption limits, expiry and "first purchase only" at Checkout. Admins
// create and switch them off in Admin > Promo codes; customers enter one on
// /subscription/upgrade (or Stripe's own Checkout field when none was
// entered). Nothing about codes is stored in our database.

export type PromoTierKey = "PREMIUM" | "PREMIUM_PLUS"

export { normalizePromoCode }
export { describeDiscount, discountCents, discountOf, type PromoDiscount } from "./promo-discount"

export const promoCreateSchema = z
  .object({
    code: z.string().transform((v, ctx) => {
      const code = normalizePromoCode(v)
      if (!code) ctx.addIssue({ code: "custom", message: "Codes are 3-30 letters, numbers, - or _" })
      return code ?? ""
    }),
    kind: z.enum(["percent", "amount"]),
    // Percent 1-100, or dollars off (sent as dollars, stored in cents).
    value: z.number().positive(),
    duration: z.enum(["once", "repeating", "forever"]),
    months: z.number().int().min(1).max(36).optional(),
    appliesTo: z.enum(["ALL", "PREMIUM", "PREMIUM_PLUS"]).default("ALL"),
    maxRedemptions: z.number().int().min(1).max(100000).optional(),
    // YYYY-MM-DD; the code stops working at the end of that day (UTC).
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    firstTimeOnly: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent" && (v.value > 100 || !Number.isInteger(v.value * 100))) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Percent off is 1-100" })
    }
    if (v.kind === "amount" && Math.round(v.value * 100) < 1) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an amount off" })
    }
    if (v.duration === "repeating" && !v.months) {
      ctx.addIssue({ code: "custom", path: ["months"], message: "How many months?" })
    }
  })

export type PromoCreateInput = z.infer<typeof promoCreateSchema>

/** End of the given UTC day, as Stripe's unix seconds; null if not in the future. */
export function expiresAtFor(expiresOn: string | undefined, now = Date.now()): number | null | undefined {
  if (!expiresOn) return undefined
  const end = Date.parse(`${expiresOn}T23:59:59Z`)
  if (!Number.isFinite(end) || end <= now) return null
  return Math.floor(end / 1000)
}

export function couponParamsFor(input: PromoCreateInput, productIds: string[]): Stripe.CouponCreateParams {
  return {
    name: input.code,
    duration: input.duration,
    ...(input.duration === "repeating" ? { duration_in_months: input.months } : {}),
    ...(input.kind === "percent"
      ? { percent_off: input.value }
      : { amount_off: Math.round(input.value * 100), currency: "usd" }),
    ...(productIds.length > 0 ? { applies_to: { products: productIds } } : {}),
    metadata: { source: "togethr-admin" },
  }
}

export function promotionCodeParamsFor(
  input: PromoCreateInput,
  couponId: string,
  adminId: string,
  expiresAt: number | undefined
): Stripe.PromotionCodeCreateParams {
  return {
    promotion: { type: "coupon", coupon: couponId },
    code: input.code,
    ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(input.firstTimeOnly ? { restrictions: { first_time_transaction: true } } : {}),
    metadata: { createdByAdmin: adminId, appliesTo: input.appliesTo },
  }
}

type PromoStripe = {
  promotionCodes: { list: (p: Stripe.PromotionCodeListParams) => Promise<{ data: Stripe.PromotionCode[] }> }
}

export type PromoLookup =
  | { ok: true; promotionCodeId: string; code: string; discount: PromoDiscount }
  | { ok: false; error: string }

const NOT_VALID = "That promo code isn't valid."

/**
 * An active code that can be used for this plan, or why not. Stripe checks
 * again at Checkout (and alone knows "first purchase only" for a customer).
 */
export async function findUsablePromoCode(
  stripeClient: PromoStripe,
  rawCode: unknown,
  plan: { tier: PromoTierKey; productId: string | null },
  now = Date.now()
): Promise<PromoLookup> {
  const code = normalizePromoCode(rawCode)
  if (!code) return { ok: false, error: NOT_VALID }
  const { data } = await stripeClient.promotionCodes.list({ code, active: true, limit: 1, expand: ["data.promotion.coupon.applies_to"] })
  const promo = data[0]
  if (!promo) return { ok: false, error: NOT_VALID }
  if (promo.expires_at && promo.expires_at * 1000 <= now) return { ok: false, error: "That promo code has expired." }
  if (promo.max_redemptions && promo.times_redeemed >= promo.max_redemptions) {
    return { ok: false, error: "That promo code has been used up." }
  }
  const coupon = promo.promotion.coupon
  if (!coupon || typeof coupon === "string" || !coupon.valid) return { ok: false, error: NOT_VALID }
  // applies_to is the rule Stripe enforces; the metadata copy covers a coupon
  // whose product list wasn't returned.
  const products = coupon.applies_to?.products ?? []
  const forTier = promo.metadata?.appliesTo
  if (
    (products.length > 0 && (!plan.productId || !products.includes(plan.productId))) ||
    ((forTier === "PREMIUM" || forTier === "PREMIUM_PLUS") && forTier !== plan.tier)
  ) {
    return { ok: false, error: "That promo code doesn't apply to this plan." }
  }
  return { ok: true, promotionCodeId: promo.id, code: promo.code, discount: discountOf(coupon) }
}

/** A row for Admin > Promo codes. */
export interface PromoCodeRow {
  id: string
  code: string
  active: boolean
  description: string
  appliesTo: string
  timesRedeemed: number
  maxRedemptions: number | null
  expiresAt: string | null
  firstTimeOnly: boolean
  createdAt: string
}

export function promoCodeRow(p: Stripe.PromotionCode): PromoCodeRow {
  const coupon = p.promotion.coupon
  const description = coupon && typeof coupon !== "string" ? describeDiscount(discountOf(coupon)) : ""
  return {
    id: p.id,
    code: p.code,
    active: p.active,
    description,
    appliesTo: p.metadata?.appliesTo || "ALL",
    timesRedeemed: p.times_redeemed,
    maxRedemptions: p.max_redemptions,
    expiresAt: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null,
    firstTimeOnly: p.restrictions?.first_time_transaction === true,
    createdAt: new Date(p.created * 1000).toISOString(),
  }
}

export const PROMO_PERMISSION_ERROR =
  "Stripe key can't create promo codes. In Stripe, give the restricted key Coupons: Write and Promotion codes: Write."

/**
 * A Stripe error from the admin promo routes as a status and a message safe to
 * show: a missing key permission is a 403 with what to fix, and no key prefix
 * or account id is ever echoed.
 */
export function promoStripeError(error: unknown, fallback: string): { status: number; error: string } {
  const e = error as { type?: string; statusCode?: number; message?: string } | null
  if (e?.type === "StripePermissionError" || (e?.statusCode === 403 && /permission/i.test(e.message ?? ""))) {
    return { status: 403, error: PROMO_PERMISSION_ERROR }
  }
  const message = e?.message
    ?.replace(/\b[a-z]{2,4}_(live|test)_[^\s'"]*/g, "[key]")
    .replace(/\bacct_[A-Za-z0-9]+/g, "[account]")
  return { status: 502, error: message ? `Stripe: ${message}` : fallback }
}
