import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFromToken, hasPermission, logAdminAction } from "@/lib/admin-auth"
import { stripe } from "@/lib/stripe"
import { promoCodeRow, promoStripeError } from "@/lib/promo-codes"

const schema = z.object({ active: z.boolean() })

// PATCH { active } - switch a code off (or back on). Families already
// using its discount keep it; Stripe stops accepting the code.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ promoId: string }> }) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  const admin = token ? await getAdminFromToken(token) : null
  if (!admin || !hasPermission(admin, "subscriptions.update")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { promoId } = await params
  if (!/^promo_[A-Za-z0-9]+$/.test(promoId)) return NextResponse.json({ error: "Unknown code" }, { status: 404 })
  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "Send { active: true | false }" }, { status: 400 })

  try {
    const promo = await stripe.promotionCodes.update(promoId, { active: parsed.data.active, expand: ["promotion.coupon"] })
    await logAdminAction(admin.id, parsed.data.active ? "ENABLE_PROMO_CODE" : "DISABLE_PROMO_CODE", "promo_code", promo.id, {
      code: promo.code,
    })
    return NextResponse.json({ success: true, data: promoCodeRow(promo) })
  } catch (error) {
    console.error("Update promo code error:", error)
    const { status, error: message } = promoStripeError(error, "Couldn't update the code")
    return NextResponse.json({ error: message }, { status })
  }
}
