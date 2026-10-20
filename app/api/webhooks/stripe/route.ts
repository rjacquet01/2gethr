import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { stripe, getTierFromPriceId } from "@/lib/stripe"
import { notifyAdmin, EMAIL_TEMPLATES } from "@/lib/services/email"
import { handleChargeRefunded, handleDisputeClosed, handleDisputeCreated } from "@/lib/stripe-disputes"
import type Stripe from "stripe"

// Looks up the family name and the owning user's email for the admin
// notification templates below. Returns null if the family can't be found
// (shouldn't happen in practice, but notifications must never throw).
async function getFamilyOwnerInfo(familyId: string): Promise<{ familyName: string; ownerEmail: string } | null> {
  try {
    const rows = await sql`
      SELECT f.name AS family_name, u.email AS owner_email
      FROM families f
      JOIN users u ON u.id = f.owner_id
      WHERE f.id = ${familyId}
    `
    if (rows.length === 0) return null
    return { familyName: rows[0].family_name, ownerEmail: rows[0].owner_email }
  } catch (error) {
    console.error("[admin-notify] failed to look up family owner info:", error)
    return null
  }
}

// Stripe webhook handler for the subscription lifecycle. This is NOT
// optional: fulfillment and subscription-state changes happen
// asynchronously (after Checkout redirects the customer back), so a
// checkout-success page alone would miss renewals, failed payments,
// cancellations, and delayed/async payment methods.
//
// Handles:
//  - checkout.session.completed
//  - checkout.session.async_payment_succeeded (delayed payment methods)
//  - customer.subscription.updated
//  - customer.subscription.deleted
//  - invoice.paid
//  - invoice.payment_failed
//  - charge.dispute.created  (admin alert + history note; tier unchanged)
//  - charge.dispute.closed   (admin alert; lost marks the payment; tier unchanged)
//  - charge.refunded         (payment row updated + admin alert; tier unchanged)
// (lib/stripe-disputes.ts)

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 })
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  // Verify the signature against the RAW request body. Do not JSON.parse
  // before this — Stripe's signature covers the exact raw bytes sent.
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (error) {
    console.error("Webhook signature verification failed:", error)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        // Async payment methods (e.g. some bank debits) aren't paid yet at
        // this point — wait for checkout.session.async_payment_succeeded
        // before fulfilling in that case.
        if (session.mode === "subscription" && session.payment_status === "paid") {
          await activateSubscriptionFromSession(session)
        }
        break
      }

      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === "subscription") {
          await activateSubscriptionFromSession(session)
        }
        break
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription
        await syncSubscriptionFromStripe(sub)
        break
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionCanceled(sub)
        break
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice
        await recordInvoicePayment(invoice, "COMPLETED")
        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        await recordInvoicePayment(invoice, "FAILED")
        break
      }

      case "charge.dispute.created":
        await handleDisputeCreated(event.data.object as Stripe.Dispute, event.livemode)
        break

      case "charge.dispute.closed":
        await handleDisputeClosed(event.data.object as Stripe.Dispute, event.livemode)
        break

      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge, event.livemode)
        break

      default:
        // Unhandled event types are fine to ignore — we only listen for
        // the events registered on this webhook endpoint in Stripe.
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error(`Error handling webhook event ${event.type}:`, error)
    // Return 500 so Stripe retries delivery.
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}

// Stripe subscription status -> our subscriptions.status
const STRIPE_STATUS_MAP: Record<string, string> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  canceled: "CANCELLED",
  unpaid: "PAST_DUE",
  incomplete: "PAST_DUE",
  incomplete_expired: "CANCELLED",
  paused: "CANCELLED",
}

async function activateSubscriptionFromSession(session: Stripe.Checkout.Session) {
  const familyId = session.metadata?.familyId
  const requestedTier = session.metadata?.requestedTier
  if (!familyId || !session.subscription || !session.customer) return

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id
  const customerId = typeof session.customer === "string" ? session.customer : session.customer.id

  const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
  const priceId = stripeSub.items.data[0]?.price.id
  // Use the subscription's live status: a checkout event redelivered after
  // the subscription was cancelled must not put the family back on a paid plan.
  const liveStatus = STRIPE_STATUS_MAP[stripeSub.status] ?? "ACTIVE"
  const tier = liveStatus === "CANCELLED" ? "FREE" : getTierFromPriceId(priceId) ?? requestedTier ?? "FREE"

  const existing = await sql`SELECT * FROM subscriptions WHERE family_id = ${familyId}`
  const previousTier = existing[0]?.tier ?? "FREE"
  const item = stripeSub.items.data[0]

  await sql`
    UPDATE subscriptions
    SET tier = ${tier},
        status = ${liveStatus},
        stripe_customer_id = ${customerId},
        stripe_subscription_id = ${subscriptionId},
        stripe_price_id = ${priceId ?? null},
        current_period_start = ${item ? new Date(item.current_period_start * 1000).toISOString() : null},
        current_period_end = ${item ? new Date(item.current_period_end * 1000).toISOString() : null},
        cancel_at_period_end = ${stripeSub.cancel_at_period_end},
        updated_at = NOW()
    WHERE family_id = ${familyId}
  `

  if (existing.length > 0 && previousTier !== tier) {
    await sql`
      INSERT INTO subscription_status_history (
        id, subscription_id, old_status, new_status, source, notes, changed_at
      ) VALUES (
        gen_random_uuid(), ${existing[0].id}, ${previousTier}, ${tier},
        'WEBHOOK', 'Checkout completed via Stripe', NOW()
      )
    `

    const info = await getFamilyOwnerInfo(familyId)
    if (info) {
      const notice = EMAIL_TEMPLATES.ADMIN_TIER_CHANGED(info.ownerEmail, info.familyName, previousTier, tier)
      await notifyAdmin(notice.subject, notice.html, notice.text)
    }
  }
}

async function syncSubscriptionFromStripe(sub: Stripe.Subscription) {
  const familyId = sub.metadata?.familyId
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id

  // Prefer metadata on the subscription, but fall back to looking the
  // family up by Stripe customer ID in case metadata wasn't set (e.g. a
  // subscription changed directly in the Stripe Dashboard).
  const existing = familyId
    ? await sql`SELECT * FROM subscriptions WHERE family_id = ${familyId}`
    : await sql`SELECT * FROM subscriptions WHERE stripe_customer_id = ${customerId}`

  if (existing.length === 0) return

  const priceId = sub.items.data[0]?.price.id
  const previousTier = existing[0].tier
  const tier = getTierFromPriceId(priceId) ?? existing[0].tier
  const item = sub.items.data[0]

  const newStatus = STRIPE_STATUS_MAP[sub.status] ?? "ACTIVE"
  const previousStatus = existing[0].status

  await sql`
    UPDATE subscriptions
    SET tier = ${tier},
        status = ${newStatus},
        stripe_customer_id = ${customerId},
        stripe_subscription_id = ${sub.id},
        stripe_price_id = ${priceId ?? null},
        current_period_start = ${item ? new Date(item.current_period_start * 1000).toISOString() : null},
        current_period_end = ${item ? new Date(item.current_period_end * 1000).toISOString() : null},
        cancel_at_period_end = ${sub.cancel_at_period_end},
        trial_ends_at = COALESCE(${sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null}::timestamptz, trial_ends_at),
        updated_at = NOW()
    WHERE family_id = ${existing[0].family_id}
  `

  if (previousStatus !== newStatus) {
    await sql`
      INSERT INTO subscription_status_history (
        id, subscription_id, old_status, new_status, source, notes, changed_at
      ) VALUES (
        gen_random_uuid(), ${existing[0].id}, ${previousStatus}, ${newStatus},
        'WEBHOOK', 'customer.subscription.updated', NOW()
      )
    `
  }

  // Tier can change independently of status (e.g. an upgrade/downgrade
  // while the subscription stays ACTIVE the whole time), so this is
  // checked separately from the status-history block above.
  if (previousTier !== tier) {
    const info = await getFamilyOwnerInfo(existing[0].family_id)
    if (info) {
      const notice = EMAIL_TEMPLATES.ADMIN_TIER_CHANGED(info.ownerEmail, info.familyName, previousTier, tier)
      await notifyAdmin(notice.subject, notice.html, notice.text)
    }
  }
}

async function handleSubscriptionCanceled(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  const familyId = sub.metadata?.familyId

  const existing = familyId
    ? await sql`SELECT * FROM subscriptions WHERE family_id = ${familyId}`
    : await sql`SELECT * FROM subscriptions WHERE stripe_customer_id = ${customerId}`

  if (existing.length === 0) return

  await sql`
    UPDATE subscriptions
    SET tier = 'FREE',
        status = 'CANCELLED',
        cancel_at_period_end = false,
        updated_at = NOW()
    WHERE family_id = ${existing[0].family_id}
  `

  await sql`
    INSERT INTO subscription_status_history (
      id, subscription_id, old_status, new_status, source, notes, changed_at
    ) VALUES (
      gen_random_uuid(), ${existing[0].id}, ${existing[0].status}, 'CANCELLED',
      'WEBHOOK', 'customer.subscription.deleted', NOW()
    )
  `

  const info = await getFamilyOwnerInfo(existing[0].family_id)
  if (info) {
    const notice = EMAIL_TEMPLATES.ADMIN_SUBSCRIPTION_CANCELLED(info.ownerEmail, info.familyName, existing[0].tier)
    await notifyAdmin(notice.subject, notice.html, notice.text)
  }
}

async function recordInvoicePayment(invoice: Stripe.Invoice, status: "COMPLETED" | "FAILED") {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id
  if (!customerId) return

  // A payment_failed event can arrive after a retry already succeeded: check
  // the invoice's current state before marking the family past due.
  if (status === "FAILED" && invoice.id) {
    const live = await stripe.invoices.retrieve(invoice.id)
    if (live.status === "paid") status = "COMPLETED"
  }

  const existing = await sql`SELECT * FROM subscriptions WHERE stripe_customer_id = ${customerId}`
  if (existing.length === 0) return

  // Avoid inserting duplicate rows if Stripe retries/redelivers the event.
  if (invoice.id) {
    const already = await sql`
      SELECT id FROM payment_transactions WHERE stripe_payment_id = ${invoice.id}
    `
    if (already.length > 0) {
      await sql`
        UPDATE payment_transactions SET status = ${status} WHERE stripe_payment_id = ${invoice.id}
      `
      if (status === "FAILED") {
        await sql`
          UPDATE subscriptions SET status = 'PAST_DUE', updated_at = NOW()
          WHERE family_id = ${existing[0].family_id}
        `
      }
      return
    }
  }

  await sql`
    INSERT INTO payment_transactions (
      id, subscription_id, stripe_payment_id, amount, currency, status, description, metadata, created_at
    ) VALUES (
      gen_random_uuid()::text, ${existing[0].id}, ${invoice.id ?? null},
      ${invoice.amount_paid || invoice.amount_due || 0}, ${invoice.currency ?? "usd"},
      ${status}, ${invoice.billing_reason ?? "subscription invoice"},
      ${JSON.stringify({ hostedInvoiceUrl: invoice.hosted_invoice_url ?? null })}::jsonb,
      NOW()
    )
  `

  if (status === "FAILED") {
    await sql`
      UPDATE subscriptions SET status = 'PAST_DUE', updated_at = NOW()
      WHERE family_id = ${existing[0].family_id}
    `
  }
}
