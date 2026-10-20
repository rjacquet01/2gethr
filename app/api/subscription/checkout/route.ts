import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { purchaseBlockedForRequest } from "@/lib/android-app"
import { stripe, getPriceId } from "@/lib/stripe"
import { buildCheckoutSessionParams, subscriptionUpdateTaxParams } from "@/lib/stripe-checkout"

// POST - Create a Stripe Checkout Session for a subscription upgrade.
//
// This replaces the old /api/subscription/upgrade flow, which collected raw
// card number/CVV in the browser and base64-"encoded" it before sending it
// to our backend for manual admin processing. That never touched Stripe and
// was not PCI compliant. Real card data now goes straight from the
// customer's browser to Stripe via the hosted Checkout page — it never
// reaches our server or database.
export async function POST(request: NextRequest) {
  try {
    if (purchaseBlockedForRequest(request)) {
      return NextResponse.json({ error: "Not available in this app" }, { status: 403 })
    }
    const { user } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { familyId, tier, billingCycle } = body

    if (!familyId || !tier || !billingCycle) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const priceId = getPriceId(tier, billingCycle)
    if (!priceId) {
      return NextResponse.json({ error: "Invalid tier or billing cycle" }, { status: 400 })
    }

    // Verify the user is in the family and is the owner (only owners can
    // manage billing). Ownership lives on families.owner_id, not on a
    // family_members.role value of "owner" — this app's roles are
    // PARENT/CHILD, and the owner is just whichever member's user_id
    // matches the family's owner_id (see app/api/families/route.ts).
    const membership = await sql`
      SELECT fm.*, f.name as family_name, f.owner_id
      FROM family_members fm
      JOIN families f ON f.id = fm.family_id
      WHERE fm.family_id = ${familyId} AND fm.user_id = ${user.id}
    `

    if (membership.length === 0) {
      return NextResponse.json({ error: "Not a member of this family" }, { status: 403 })
    }

    if (membership[0].owner_id !== user.id) {
      return NextResponse.json({ error: "Only family owners can manage subscriptions" }, { status: 403 })
    }

    // Get or create the subscription row for this family, and reuse an
    // existing Stripe Customer if we already created one for it.
    let subscription = await sql`
      SELECT * FROM subscriptions WHERE family_id = ${familyId}
    `

    if (subscription.length === 0) {
      subscription = await sql`
        INSERT INTO subscriptions (
          id, family_id, tier, status, created_at, updated_at
        ) VALUES (
          gen_random_uuid()::text, ${familyId}, 'FREE', 'ACTIVE', NOW(), NOW()
        )
        RETURNING *
      `
    }

    let customerId: string | null = subscription[0].stripe_customer_id

    // A stored customer ID can point at a Customer that doesn't exist under
    // the currently configured Stripe account/mode (e.g. a row written
    // before this account's live-mode keys were set up, or data carried
    // over from a different Stripe account). Verify it actually resolves
    // before reusing it, rather than letting checkout.sessions.create fail
    // with "No such customer" further down.
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId)
        if (existing.deleted) {
          customerId = null
        }
      } catch {
        customerId = null
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
        metadata: {
          familyId,
          userId: user.id,
        },
      })
      customerId = customer.id

      await sql`
        UPDATE subscriptions
        SET stripe_customer_id = ${customerId}, updated_at = NOW()
        WHERE family_id = ${familyId}
      `
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000"

    // Already paying through Stripe? Switch the existing subscription's
    // price (prorated) instead of opening a second Checkout - a second
    // checkout would create a duplicate subscription and double-bill. The
    // customer.subscription.updated webhook then syncs the new tier.
    const currentStripeSubId: string | null = subscription[0].stripe_subscription_id
    if (currentStripeSubId && subscription[0].status !== "CANCELLED") {
      try {
        const current = await stripe.subscriptions.retrieve(currentStripeSubId)
        if (current.status !== "canceled") {
          const item = current.items.data[0]
          if (item && item.price.id !== priceId) {
            await stripe.subscriptions.update(currentStripeSubId, {
              items: [{ id: item.id, price: priceId }],
              proration_behavior: "create_prorations",
              cancel_at_period_end: false,
              metadata: { familyId, requestedTier: tier.toUpperCase(), billingCycle },
              ...subscriptionUpdateTaxParams(),
            })
          } else if (current.cancel_at_period_end) {
            // Same plan, but set to end: subscribing again means "keep it".
            await stripe.subscriptions.update(currentStripeSubId, { cancel_at_period_end: false })
          }
          return NextResponse.json({
            success: true,
            updated: true,
            url: `${appUrl}/subscription/confirmation?updated=1`,
          })
        }
      } catch (err) {
        // Only a subscription that no longer exists in Stripe may fall through
        // to a new Checkout. Any other error (network, rate limit) could leave
        // the old one running, and a second Checkout would bill twice.
        const code = (err as { code?: string })?.code
        if (code !== "resource_missing") {
          console.error("Existing subscription update failed:", err)
          return NextResponse.json(
            { success: false, error: "We couldn't change your plan right now. Please try again in a minute." },
            { status: 502 }
          )
        }
        console.warn("Stored Stripe subscription no longer exists; starting a new checkout")
      }
    }

    // A random 8-letter suffix for the integration_identifier tag, per
    // Stripe's Checkout Session tracking recommendation.
    const randomSuffix = Math.random().toString(36).replace(/[^a-z]/g, "").padEnd(8, "x").slice(0, 8)

    // Intentionally no payment_method_types (see lib/stripe-checkout.ts).
    // Stripe Tax fields are added only when STRIPE_TAX_ENABLED is "true".
    const session = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        customerId,
        priceId,
        familyId,
        tier,
        billingCycle,
        userId: user.id,
        appUrl,
        randomSuffix,
      })
    )

    return NextResponse.json({
      success: true,
      url: session.url,
    })
  } catch (error) {
    console.error("Checkout session creation error:", error)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
