import type Stripe from "stripe"

/**
 * Stripe Tax is OFF unless STRIPE_TAX_ENABLED is exactly "true" (see
 * docs/STRIPE_TAX_SETUP.md). Prices need tax_behavior set in the Stripe
 * Dashboard (it is deliberately not set in code), and automatic tax only
 * calculates once a tax registration exists in Stripe Tax: enabling this
 * without a registration silently charges no tax.
 */
export function stripeTaxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED === "true"
}

/** Extra Checkout Session fields for Stripe Tax; empty when it is off. */
export function checkoutTaxParams(): Partial<Stripe.Checkout.SessionCreateParams> {
  if (!stripeTaxEnabled()) return {}
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    // Tax needs the customer's address saved on the existing Customer.
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: false },
  }
}

/** Extra fields for the plan-switch subscriptions.update call; empty when off. */
export function subscriptionUpdateTaxParams(): Partial<Stripe.SubscriptionUpdateParams> {
  return stripeTaxEnabled() ? { automatic_tax: { enabled: true } } : {}
}

/** The subscription Checkout Session. With tax off this is exactly the pre-tax session. */
export function buildCheckoutSessionParams(opts: {
  customerId: string
  priceId: string
  familyId: string
  tier: string
  billingCycle: string
  userId: string
  appUrl: string
  randomSuffix: string
}): Stripe.Checkout.SessionCreateParams {
  const { customerId, priceId, familyId, tier, billingCycle, userId, appUrl, randomSuffix } = opts
  const metadata = {
    familyId,
    requestedTier: tier.toUpperCase(),
    billingCycle,
    requestedBy: userId,
  }
  return {
    mode: "subscription",
    customer: customerId,
    // Intentionally no payment_method_types here — Stripe determines
    // eligible payment methods dynamically from the Dashboard config.
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { ...metadata } },
    metadata: { ...metadata },
    integration_identifier: `togethr_${randomSuffix}`,
    success_url: `${appUrl}/subscription/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/subscription/upgrade?tier=${encodeURIComponent(tier)}&billing=${billingCycle === "annual" ? "annual" : "monthly"}`,
    ...checkoutTaxParams(),
  }
}
