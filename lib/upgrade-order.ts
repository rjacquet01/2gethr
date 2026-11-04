import { SUBSCRIPTION_TIERS } from "./subscription-tiers"

// The upgrade page's selection (from ?tier=&billing=) and its order summary.
// Amounts come from lib/subscription-tiers.ts, in cents.

export type PaidTierKey = "PREMIUM" | "PREMIUM_PLUS"
export type BillingCycle = "monthly" | "annual"

/** The plan a family pays for through Stripe now, if any. */
export type CurrentPlan = { tier: PaidTierKey; billing: BillingCycle } | null

/**
 * ?tier= takes the internal keys (PREMIUM = Plus, PREMIUM_PLUS = Premium, as the
 * Subscription page links) or the display name "plus". ?billing= takes
 * monthly or annual/yearly. Anything else, or nothing, is the family's current
 * plan when it pays, else Plus / monthly.
 */
export function parseUpgradeParams(tier: string | null | undefined, billing: string | null | undefined, current: CurrentPlan = null): { tier: PaidTierKey; billing: BillingCycle } {
  const t = (tier || "").trim().toUpperCase().replace(/[\s-]+/g, "_")
  const b = (billing || "").trim().toLowerCase()
  return {
    tier: t === "PREMIUM_PLUS" ? "PREMIUM_PLUS" : t === "PREMIUM" || t === "PLUS" ? "PREMIUM" : current?.tier ?? "PREMIUM",
    billing: b === "annual" || b === "yearly" ? "annual" : b === "monthly" ? "monthly" : current?.billing ?? "monthly",
  }
}

const TIER_RANK: Record<PaidTierKey, number> = { PREMIUM: 1, PREMIUM_PLUS: 2 }

export type PlanChange = "new" | "same" | "resume" | "upgrade" | "downgrade" | "billing"

/** What Continue does for a family on `current` (null = not paying) picking `next`. */
export function planChange(current: CurrentPlan, next: { tier: PaidTierKey; billing: BillingCycle }, cancelPending = false): PlanChange {
  if (!current) return "new"
  if (TIER_RANK[next.tier] > TIER_RANK[current.tier]) return "upgrade"
  if (TIER_RANK[next.tier] < TIER_RANK[current.tier]) return "downgrade"
  if (next.billing !== current.billing) return "billing"
  return cancelPending ? "resume" : "same"
}

/** The upgrade page's title and button for a plan change. */
export function upgradePageCopy(change: PlanChange, tierName: string, billing: BillingCycle): { title: string; button: string } {
  switch (change) {
    case "new": return { title: `Upgrade to ${tierName}`, button: "Continue to secure checkout" }
    case "upgrade": return { title: `Upgrade to ${tierName}`, button: `Upgrade to ${tierName}` }
    case "downgrade": return { title: `Switch to ${tierName} (downgrade)`, button: `Switch to ${tierName} (downgrade)` }
    case "billing": return { title: `Switch to ${billing} billing`, button: `Switch to ${billing} billing` }
    case "resume": return { title: `Keep ${tierName}`, button: `Keep ${tierName}` }
    case "same": return { title: `You're on ${tierName}`, button: "You are already on this plan" }
  }
}

/** The confirm step before a downgrade: when it takes effect, and that no credit is given. */
export function downgradeNotice(fromName: string, toName: string): string {
  return `Your plan changes from ${fromName} to ${toName} right away, and ${fromName} features stop now. ` +
    `There is no credit or refund for the rest of this billing period. Your next bill is at the ${toName} price.`
}

/**
 * The confirmation page after Continue. "Payment Successful" only after a
 * Stripe Checkout (session_id); a switch of an existing plan (updated=1) charged
 * nothing new, or only the upgrade difference.
 */
export function confirmationCopy(p: { sessionId?: string | null; updated?: string | null; tierName?: string | null; change?: string | null }): { title: string; description: string; body: string } {
  if (p.updated === "1" && !p.sessionId) {
    const plan = p.tierName ? `You're now on ${p.tierName}.` : "Your plan was updated."
    const when =
      p.change === "upgrade" ? "The new features are available now. The difference for the rest of this billing period was charged to your card on file."
      : p.change === "upgrade_next_bill" ? "The new features are available now. The new price starts with your next bill."
      : p.change === "downgrade" ? "The change took effect right away, with no credit for the rest of this billing period. Your next bill is at the new price."
      : p.change === "billing" ? "The new price starts with your next bill. Nothing was charged today."
      : p.change === "resume" ? "Your plan will keep renewing. Nothing was charged today."
      : "Nothing new was charged today."
    return {
      title: p.change === "resume" ? "Your plan will continue" : "Your plan was changed",
      description: plan,
      body: `${when} You can manage billing details (payment method, invoices, cancellation) any time from the Subscription page.`,
    }
  }
  if (!p.sessionId) {
    return {
      title: "Your subscription",
      description: "Nothing was charged on this page.",
      body: "Your current plan and billing details are on the Subscription page.",
    }
  }
  return {
    title: "Payment Successful!",
    description: "Thank you for upgrading your Togethr plan",
    body: "Your subscription is now active. Stripe processed your payment securely, and your new plan's features are available right away. " +
      "You'll get an email receipt from Stripe, and you can manage your billing details (payment method, invoices, cancellation) any time from the Subscription page.",
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
