import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { purchaseBlockedForRequest } from "@/lib/android-app"
import { stripe, getPriceId } from "@/lib/stripe"
import { hitRateLimit, tooManyRequests } from "@/lib/rate-limit"
import { describeDiscount, findUsablePromoCode, type PromoTierKey } from "@/lib/promo-codes"

// POST { code, tier, billingCycle } - is this promo code usable for this
// plan? For the upgrade page's order summary; Checkout checks it again.
// Limited per account so codes can't be guessed.
export async function POST(request: NextRequest) {
  try {
    if (purchaseBlockedForRequest(request)) {
      return NextResponse.json({ error: "Not available in this app" }, { status: 403 })
    }
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = await hitRateLimit(`promo-check:${user.id}`, 20, 60 * 60)
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec, "promo code checks")

    const body = await request.json().catch(() => ({}))
    const priceId = getPriceId(body.tier, body.billingCycle)
    if (!priceId) return NextResponse.json({ error: "Invalid tier or billing cycle" }, { status: 400 })

    const price = await stripe.prices.retrieve(priceId)
    const found = await findUsablePromoCode(stripe, body.code, {
      tier: String(body.tier).toUpperCase() as PromoTierKey,
      productId: typeof price.product === "string" ? price.product : price.product.id,
    })
    if (!found.ok) return NextResponse.json({ success: false, error: found.error })
    return NextResponse.json({
      success: true,
      data: { code: found.code, description: describeDiscount(found.discount), discount: found.discount },
    })
  } catch (error) {
    console.error("Promo code check error:", error)
    return NextResponse.json({ error: "Couldn't check that code right now" }, { status: 500 })
  }
}
