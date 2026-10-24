import { SUBSCRIPTION_TIERS } from "./subscription-tiers"

// The upgrade page's selection (from ?tier=&billing=) and its order summary.
// Amounts come from lib/subscription-tiers.ts, in cents.

export type PaidTierKey = "PREMIUM" | "PREMIUM_PLUS"
export type BillingCycle = "monthly" | "annual"

/**
 * ?tier= takes the internal keys (PREMIUM = Plus, PREMIUM_PLUS = Premium, as the
 * Subscription page links) or the display name "plus". Anything else, or
 * nothing, is Plus. ?billing= is monthly unless it says annual/yearly.
 */
export function parseUpgradeParams(tier: string | null | undefined, billing: string | null | undefined): { tier: PaidTierKey; billing: BillingCycle } {
  const t = (tier || "").trim().toUpperCase().replace(/[\s-]+/g, "_")
  const b = (billing || "").trim().toLowerCase()
  return {
    tier: t === "PREMIUM_PLUS" ? "PREMIUM_PLUS" : "PREMIUM",
    billing: b === "annual" || b === "yearly" ? "annual" : "monthly",
  }
}

/** list = before the discount (12 x monthly for annual), total = what is charged. */
export function orderSummaryCents(tier: PaidTierKey, billing: BillingCycle): { listCents: number; discountCents: number; totalCents: number } {
  const def = SUBSCRIPTION_TIERS[tier]
  if (billing === "monthly") {
    return { listCents: def.priceMonthlyCents, discountCents: 0, totalCents: def.priceMonthlyCents }
  }
  const listCents = def.priceMonthlyCents * 12
  return { listCents, discountCents: listCents - def.priceAnnualCents, totalCents: def.priceAnnualCents }
}

export const centsToDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
