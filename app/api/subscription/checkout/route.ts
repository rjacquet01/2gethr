import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { purchaseBlockedForRequest } from "@/lib/android-app"
import { stripe, getPriceId } from "@/lib/stripe"

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

    // A random 8-letter suffix for the integration_identifier tag, per
    // Stripe's Checkout Session tracking recommendation.
    const randomSuffix = Math.random().toString(36).replace(/[^a-z]/g, "").padEnd(8, "x").slice(0, 8)

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // Intentionally no payment_method_types here — Stripe determines
      // eligible payment methods dynamically from the Dashboard config.
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: {
          familyId,
          requestedTier: tier.toUpperCase(),
          billingCycle,
          requestedBy: user.id,
        },
      },
      metadata: {
        familyId,
        requestedTier: tier.toUpperCase(),
        billingCycle,
        requestedBy: user.id,
      },
      integration_identifier: `togethr_${randomSuffix}`,
      success_url: `${appUrl}/subscription/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscription/upgrade?tier=${encodeURIComponent(tier)}`,
    })

    return NextResponse.json({
      success: true,
      url: session.url,
    })
  } catch (error) {
    console.error("Checkout session creation error:", error)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
