import { NextRequest, NextResponse } from "next/server"
import { getAdminFromToken, hasPermission, logAdminAction } from "@/lib/admin-auth"
import { stripe, getPriceId } from "@/lib/stripe"
import {
  couponParamsFor,
  expiresAtFor,
  promoCodeRow,
  promoCreateSchema,
  promotionCodeParamsFor,
  promoStripeError,
  type PromoTierKey,
} from "@/lib/promo-codes"
import { getTierDefinition } from "@/lib/subscription-tiers"
import { notifyAccountChange, requestIp } from "@/lib/admin-account-alerts"

async function adminFrom(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  return token ? await getAdminFromToken(token) : null
}

// The Stripe Products behind a plan (one per tier; both billing cycles).
async function productIdsFor(appliesTo: "ALL" | PromoTierKey): Promise<string[]> {
  if (appliesTo === "ALL") return []
  const ids = new Set<string>()
  for (const cycle of ["monthly", "annual"]) {
    const priceId = getPriceId(appliesTo, cycle)
    if (!priceId) continue
    const price = await stripe.prices.retrieve(priceId)
    ids.add(typeof price.product === "string" ? price.product : price.product.id)
  }
  return [...ids]
}

// GET - every promo code (newest first), with how often each was used.
export async function GET(request: NextRequest) {
  const admin = await adminFrom(request)
  if (!admin || !hasPermission(admin, "subscriptions.read")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const list = await stripe.promotionCodes.list({ limit: 100, expand: ["data.promotion.coupon"] })
    return NextResponse.json({ success: true, data: list.data.map(promoCodeRow) })
  } catch (error) {
    console.error("List promo codes error:", error)
    return NextResponse.json({ error: "Couldn't load promo codes from Stripe" }, { status: 502 })
  }
}

// POST - create a code: a Stripe Coupon with one Promotion Code on it.
export async function POST(request: NextRequest) {
  const admin = await adminFrom(request)
  if (!admin || !hasPermission(admin, "subscriptions.update")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const parsed = promoCreateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the form" }, { status: 400 })
  }
  const input = parsed.data
  const expiresAt = expiresAtFor(input.expiresOn)
  if (expiresAt === null) return NextResponse.json({ error: "The end date must be in the future" }, { status: 400 })

  try {
    const taken = await stripe.promotionCodes.list({ code: input.code, active: true, limit: 1 })
    if (taken.data.length > 0) return NextResponse.json({ error: `${input.code} is already in use` }, { status: 409 })

    const coupon = await stripe.coupons.create(couponParamsFor(input, await productIdsFor(input.appliesTo)))
    let promo
    try {
      promo = await stripe.promotionCodes.create(promotionCodeParamsFor(input, coupon.id, admin.id, expiresAt))
    } catch (err) {
      // Don't leave an unused coupon behind.
      await stripe.coupons.del(coupon.id).catch(() => {})
      throw err
    }

    await logAdminAction(admin.id, "CREATE_PROMO_CODE", "promo_code", promo.id, {
      code: promo.code,
      couponId: coupon.id,
      kind: input.kind,
      value: input.value,
      duration: input.duration,
      months: input.months ?? null,
      appliesTo: input.appliesTo,
      maxRedemptions: input.maxRedemptions ?? null,
      expiresOn: input.expiresOn ?? null,
      firstTimeOnly: input.firstTimeOnly,
    })
    await notifyAccountChange({
      actor: admin.email,
      actorType: "admin",
      accountEmail: promo.code,
      change: "Promo code created",
      details: {
        discount: input.kind === "percent" ? `${input.value}% off` : `$${input.value} off`,
        duration: input.duration === "repeating" ? `${input.months} months` : input.duration,
        appliesTo: input.appliesTo === "ALL" ? "All plans" : getTierDefinition(input.appliesTo).name,
        maxRedemptions: input.maxRedemptions ?? null,
        expiresOn: input.expiresOn ?? null,
      },
      ipAddress: requestIp(request),
    })

    const full = await stripe.promotionCodes.retrieve(promo.id, { expand: ["promotion.coupon"] })
    return NextResponse.json({ success: true, data: promoCodeRow(full) })
  } catch (error) {
    console.error("Create promo code error:", error)
    const { status, error: message } = promoStripeError(error, "Couldn't create the code")
    return NextResponse.json({ error: message }, { status })
  }
}
