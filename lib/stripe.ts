import Stripe from "stripe"

// SECURITY FIX: this used to fall back to hardcoded/insecure client-side card
// handling in the upgrade page (base64 "encoding" of raw PAN/CVV). Real card
// data now never touches our server — Stripe Checkout collects it directly.
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY environment variable must be set")
}

// Always instantiate a client and call methods on the instance rather than
// using the deprecated global `stripe.apiKey = ...` pattern.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-08-26.dahlia",
  appInfo: {
    name: "Togethr",
    url: "https://mytogethr.com",
  },
})

// Subscription tier -> Stripe Price ID mapping. One Product per plan
// (Togethr Basic / Togethr Premium in the Stripe Dashboard), with a Price
// per billing cycle (monthly/annual) attached to each Product.
export const STRIPE_PRICE_IDS = {
  PREMIUM: {
    monthly: process.env.STRIPE_PRICE_BASIC_MONTHLY!,
    annual: process.env.STRIPE_PRICE_BASIC_ANNUAL!,
  },
  PREMIUM_PLUS: {
    monthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY!,
    annual: process.env.STRIPE_PRICE_PREMIUM_ANNUAL!,
  },
} as const

export type SubscriptionTier = keyof typeof STRIPE_PRICE_IDS
export type BillingCycle = "monthly" | "annual"

export function getPriceId(tier: string, billingCycle: string): string | null {
  const tierKey = tier?.toUpperCase() as SubscriptionTier
  const cycleKey = billingCycle === "annual" ? "annual" : "monthly"
  const tierPrices = STRIPE_PRICE_IDS[tierKey]
  if (!tierPrices) return null
  return tierPrices[cycleKey as BillingCycle] ?? null
}

// Reverse lookup: Stripe Price ID -> our internal tier key. Used by the
// webhook handler to figure out which tier a subscription event refers to.
export function getTierFromPriceId(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) return null
  for (const [tier, prices] of Object.entries(STRIPE_PRICE_IDS)) {
    if (prices.monthly === priceId || prices.annual === priceId) {
      return tier as SubscriptionTier
    }
  }
  return null
}
