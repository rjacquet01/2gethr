import type Stripe from "stripe"

// What a promo code takes off, and how it reads. No zod or Stripe client, so
// the upgrade page can use it in the browser.

/** The discount part of a coupon a person sees. */
export interface PromoDiscount {
  percentOff: number | null
  amountOffCents: number | null
  duration: string
  durationInMonths: number | null
}

export function discountOf(coupon: Pick<Stripe.Coupon, "percent_off" | "amount_off" | "duration" | "duration_in_months">): PromoDiscount {
  return {
    percentOff: coupon.percent_off ?? null,
    amountOffCents: coupon.amount_off ?? null,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months ?? null,
  }
}

/** "20% off for 3 months", "$5.00 off the first payment", "10% off". */
export function describeDiscount(d: PromoDiscount): string {
  const off = d.percentOff != null ? `${d.percentOff}% off` : `$${((d.amountOffCents ?? 0) / 100).toFixed(2)} off`
  if (d.duration === "once") return `${off} the first payment`
  if (d.duration === "repeating" && d.durationInMonths) {
    return `${off} for ${d.durationInMonths} month${d.durationInMonths === 1 ? "" : "s"}`
  }
  return off
}

/** Cents taken off a first payment of totalCents. */
export function discountCents(d: PromoDiscount, totalCents: number): number {
  if (d.percentOff != null) return Math.min(totalCents, Math.round((totalCents * d.percentOff) / 100))
  return Math.min(totalCents, d.amountOffCents ?? 0)
}
