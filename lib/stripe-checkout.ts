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

/** The bits of a Stripe Price that decide how a plan change is billed. */
export type PlanChangePrice = {
  unit_amount: number | null
  recurring?: { interval?: string | null; interval_count?: number | null } | null
}

/**
 * How a plan switch on an existing subscription is billed.
 *
 * An upgrade to a more expensive price on the SAME billing interval (Plus ->
 * Premium, monthly or annual) unlocks the higher tier's limits right away
 * (the customer.subscription.updated webhook syncs the tier), so the
 * difference for the rest of the current period is invoiced and charged
 * immediately. That stops "upgrade, use the bigger allowances, cancel before
 * renewal" from costing us more than was paid. If the charge fails the update
 * is rejected, so the plan does not change.
 *
 * Everything else (downgrades, same price, switching monthly <-> annual) keeps
 * the original rule: no proration, the new price starts at the next invoice.
 */
export function planChangeBilling(
  current: PlanChangePrice,
  next: PlanChangePrice
): Pick<Stripe.SubscriptionUpdateParams, "proration_behavior" | "payment_behavior"> {
  const sameInterval =
    !!current.recurring?.interval &&
    current.recurring.interval === next.recurring?.interval &&
    (current.recurring.interval_count ?? 1) === (next.recurring?.interval_count ?? 1)
  const isUpgrade =
    typeof current.unit_amount === "number" &&
    typeof next.unit_amount === "number" &&
    next.unit_amount > current.unit_amount
  if (sameInterval && isUpgrade) {
    return { proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete" }
  }
  return { proration_behavior: "none" }
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
  /** A promo code entered on our upgrade page (lib/promo-codes.ts). */
  promotionCodeId?: string
}): Stripe.Checkout.SessionCreateParams {
  const { customerId, priceId, familyId, tier, billingCycle, userId, appUrl, randomSuffix, promotionCodeId } = opts
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
    // A code from our page is applied up front; otherwise Stripe's page
    // offers its own promo code field. Stripe allows one or the other.
    ...(promotionCodeId
      ? { discounts: [{ promotion_code: promotionCodeId }] }
      : { allow_promotion_codes: true }),
    subscription_data: { metadata: { ...metadata } },
    metadata: { ...metadata },
    integration_identifier: `togethr_${randomSuffix}`,
    success_url: `${appUrl}/subscription/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/subscription/upgrade?tier=${encodeURIComponent(tier)}&billing=${billingCycle === "annual" ? "annual" : "monthly"}`,
    ...checkoutTaxParams(),
  }
}
