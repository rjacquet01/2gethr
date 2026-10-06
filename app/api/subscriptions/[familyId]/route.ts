import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { SUBSCRIPTION_TIERS } from "../route"

const updateSubscriptionSchema = z.object({
  tier: z.enum(["FREE", "PREMIUM", "PREMIUM_PLUS"]),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
})

// Upgrade/downgrade subscription (owner only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  try {
    const { familyId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Verify user is family owner
    const families = await sql`
      SELECT owner_id FROM families WHERE id = ${familyId}
    `

    if (families.length === 0) {
      return NextResponse.json(
        { success: false, error: "Family not found" },
        { status: 404 }
      )
    }

    if (families[0].owner_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "Only the family owner can manage subscriptions" },
        { status: 403 }
      )
    }

    const body = await request.json()

    // Free trial (the "Start 30-Day Trial" button on the Subscription page).
    // That button has been posting { action: 'start_trial', tier } here, but
    // this route only understood plain tier changes - and since the security
    // fix below rejects any paid tier, every trial attempt failed with a
    // "must go through Stripe Checkout" error. A trial is a time-limited,
    // no-payment grant, so it is handled explicitly here instead: owner only,
    // once per person, and only from the Free plan.
    if (body?.action === "start_trial") {
      // Default to Basic if the client doesn't say which plan to try.
      const requestedTier = body.tier ?? "PREMIUM"
      const trialTier = requestedTier === "PREMIUM" || requestedTier === "PREMIUM_PLUS" ? requestedTier : null
      if (!trialTier) {
        return NextResponse.json(
          { success: false, error: "Choose a plan to try" },
          { status: 400 }
        )
      }

      const priorTrial = await sql`
        SELECT 1 FROM subscriptions s
        JOIN families f ON f.id = s.family_id
        WHERE f.owner_id = ${user.id} AND s.trial_ends_at IS NOT NULL
        LIMIT 1
      `
      if (priorTrial.length > 0) {
        return NextResponse.json(
          { success: false, error: "Your free trial has already been used" },
          { status: 400 }
        )
      }

      const existing = await sql`
        SELECT id, tier, status FROM subscriptions
        WHERE family_id = ${familyId}
        ORDER BY created_at DESC
        LIMIT 1
      `
      const onPaidOrTrial =
        existing.length > 0 &&
        existing[0].tier !== "FREE" &&
        (existing[0].status === "ACTIVE" || existing[0].status === "TRIALING")
      if (onPaidOrTrial) {
        return NextResponse.json(
          { success: false, error: "This family is already on a paid plan or trial" },
          { status: 400 }
        )
      }

      const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      let subscriptionId: string
      if (existing.length > 0) {
        subscriptionId = existing[0].id
        await sql`
          UPDATE subscriptions SET
            tier = ${trialTier},
            status = 'TRIALING',
            trial_ends_at = ${trialEnd.toISOString()},
            current_period_start = NOW(),
            current_period_end = ${trialEnd.toISOString()},
            cancel_at_period_end = false,
            updated_at = NOW()
          WHERE id = ${subscriptionId}
        `
      } else {
        subscriptionId = crypto.randomUUID()
        await sql`
          INSERT INTO subscriptions (
            id, family_id, tier, status, trial_ends_at,
            current_period_start, current_period_end, created_at, updated_at
          )
          VALUES (
            ${subscriptionId}, ${familyId}, ${trialTier}, 'TRIALING', ${trialEnd.toISOString()},
            NOW(), ${trialEnd.toISOString()}, NOW(), NOW()
          )
        `
      }

      await sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, notes, changed_at
        ) VALUES (
          gen_random_uuid(), ${subscriptionId}, ${existing[0]?.status ?? "NONE"}, 'TRIALING',
          'USER_REQUEST', ${`30-day ${trialTier} trial started`}, NOW()
        )
      `

      await logAuditEvent(user.id, "UPDATE", "subscription_trial", familyId, {
        newValue: { tier: trialTier, trialEndsAt: trialEnd.toISOString() },
        ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      })

      return NextResponse.json({
        success: true,
        subscription: { tier: trialTier, status: "TRIALING", trialEnd: trialEnd.toISOString() },
        message: "Your 30-day free trial has started",
      })
    }

    // End a free trial early (the "Cancel trial" button on the Subscription
    // page). Trials never touch Stripe, so there is nothing to cancel there:
    // the family simply drops back to Free right away. Paid subscriptions are
    // cancelled in the Stripe billing portal instead.
    if (body?.action === "cancel_trial") {
      const trialSubs = await sql`
        SELECT id, tier, status, stripe_subscription_id FROM subscriptions
        WHERE family_id = ${familyId}
        ORDER BY created_at DESC
        LIMIT 1
      `
      if (
        trialSubs.length === 0 ||
        trialSubs[0].status !== "TRIALING" ||
        trialSubs[0].stripe_subscription_id
      ) {
        return NextResponse.json(
          { success: false, error: "There is no free trial to cancel. Use Manage Billing to cancel a paid plan." },
          { status: 400 }
        )
      }

      await sql`
        UPDATE subscriptions SET
          tier = 'FREE',
          status = 'CANCELLED',
          cancel_at_period_end = false,
          updated_at = NOW()
        WHERE id = ${trialSubs[0].id}
      `

      await sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, notes, changed_at
        ) VALUES (
          gen_random_uuid(), ${trialSubs[0].id}, 'TRIALING', 'CANCELLED',
          'USER_REQUEST', 'Free trial cancelled by the family owner', NOW()
        )
      `

      await logAuditEvent(user.id, "UPDATE", "subscription_trial", familyId, {
        oldValue: { tier: trialSubs[0].tier, status: "TRIALING" },
        newValue: { tier: "FREE", status: "CANCELLED" },
        ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      })

      return NextResponse.json({ success: true, message: "Your free trial has been cancelled" })
    }

    const { tier, billingPeriod } = updateSubscriptionSchema.parse(body)

    // SECURITY: this endpoint used to grant ANY tier — including paid ones —
    // directly in the database with no payment at all ("simulate subscription
    // change without Stripe"). That meant any authenticated family owner could
    // grant themselves PREMIUM_PLUS for free by calling this route directly.
    // Paid tier changes must go through Stripe now: see
    // POST /api/subscription/checkout (new paid tier) and the Stripe webhook
    // (/api/webhooks/stripe) which is what actually updates `tier` in the DB
    // once payment succeeds. This route now only allows moving to FREE
    // (a no-payment downgrade/cancellation-adjacent action); anything else
    // must be rejected here rather than silently granted.
    if (tier !== "FREE") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Paid tier changes must go through Stripe Checkout. Use POST /api/subscription/checkout instead.",
        },
        { status: 400 }
      )
    }

    // Get current subscription
    const currentSubs = await sql`
      SELECT id, tier, status FROM subscriptions 
      WHERE family_id = ${familyId} 
      ORDER BY created_at DESC 
      LIMIT 1
    `

    const currentTier = currentSubs.length > 0 ? currentSubs[0].tier : "FREE"

    // For now, simulate subscription change without Stripe
    // In production, this would integrate with Stripe
    const now = new Date()
    const periodEnd = new Date(now)
    if (billingPeriod === "YEARLY") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1)
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1)
    }

    if (currentSubs.length > 0) {
      // Update existing subscription
      await sql`
        UPDATE subscriptions SET
          tier = ${tier},
          status = 'ACTIVE',
          current_period_start = ${now.toISOString()},
          current_period_end = ${periodEnd.toISOString()},
          cancel_at_period_end = false,
          updated_at = NOW()
        WHERE id = ${currentSubs[0].id}
      `

      // Record transaction
      const tierInfo = SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS]
      const amount = billingPeriod === "YEARLY" ? tierInfo.priceYearly : tierInfo.priceMonthly

      if (amount > 0) {
        await sql`
          INSERT INTO payment_transactions (
            id, subscription_id, amount, currency, status, description, created_at
          )
          VALUES (
            ${crypto.randomUUID()},
            ${currentSubs[0].id},
            ${amount},
            'usd',
            'COMPLETED',
            ${`Subscription ${currentTier === tier ? "renewal" : currentTier < tier ? "upgrade" : "downgrade"} to ${tier}`},
            NOW()
          )
        `
      }
    } else {
      // Create new subscription
      const subscriptionId = crypto.randomUUID()
      await sql`
        INSERT INTO subscriptions (
          id, family_id, tier, status,
          current_period_start, current_period_end,
          created_at, updated_at
        )
        VALUES (
          ${subscriptionId},
          ${familyId},
          ${tier},
          'ACTIVE',
          ${now.toISOString()},
          ${periodEnd.toISOString()},
          NOW(), NOW()
        )
      `
    }

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "subscription", familyId, {
      oldValue: { tier: currentTier },
      newValue: { tier, billingPeriod },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      data: {
        tier,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        tierInfo: SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS],
      },
      message: `Subscription ${currentTier === tier ? "renewed" : "updated"} to ${tier}`,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Update subscription error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update subscription" },
      { status: 500 }
    )
  }
}

// Cancellation is handled by the Stripe billing portal (Subscription > Manage
// Billing -> POST /api/subscription/portal). This route used to expose a
// DELETE that opened a manual support ticket for an admin to process; nothing
// uses that flow any more, so it was removed.

// Get subscription history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  try {
    const { familyId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Verify user is a PARENT in the family
    const membership = await sql`
      SELECT role FROM family_members 
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0 || membership[0].role !== "PARENT") {
      return NextResponse.json(
        { success: false, error: "Only parents can view subscription history" },
        { status: 403 }
      )
    }

    // Get payment history
    const transactions = await sql`
      SELECT 
        pt.id, pt.amount, pt.currency, pt.status, pt.description, pt.created_at
      FROM payment_transactions pt
      JOIN subscriptions s ON pt.subscription_id = s.id
      WHERE s.family_id = ${familyId}
      ORDER BY pt.created_at DESC
      LIMIT 50
    `

    return NextResponse.json({
      success: true,
      data: {
        transactions: transactions.map(t => ({
          id: t.id,
          amount: t.amount,
          currency: t.currency,
          status: t.status,
          description: t.description,
          createdAt: t.created_at,
          formattedAmount: `$${(t.amount / 100).toFixed(2)}`,
        })),
      },
    })
  } catch (error) {
    console.error("Get subscription history error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get subscription history" },
      { status: 500 }
    )
  }
}
