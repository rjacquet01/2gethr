import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { purchaseBlockedForRequest } from "@/lib/android-app"
import { stripe } from "@/lib/stripe"
import { ensureSubscriptionCancelAtColumn, resumeParams } from "@/lib/stripe-cancel"
import { notifyAccountChange, requestIp } from "@/lib/admin-account-alerts"
import { getTierDefinition } from "@/lib/subscription-tiers"

// POST { familyId } - stop a pending cancellation so the plan keeps renewing.
// Family owner only, like the billing portal. The customer.subscription.updated
// webhook confirms the same change; the row is updated here too so the page
// doesn't wait for it.
export async function POST(request: NextRequest) {
  try {
    if (purchaseBlockedForRequest(request)) {
      return NextResponse.json({ error: "Not available in this app" }, { status: 403 })
    }
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const familyId = typeof body?.familyId === "string" ? body.familyId : null
    if (!familyId) return NextResponse.json({ error: "familyId required" }, { status: 400 })

    const membership = await sql`
      SELECT fm.role, f.owner_id, f.name AS family_name
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

    const rows = await sql`SELECT stripe_subscription_id FROM subscriptions WHERE family_id = ${familyId}`
    const subscriptionId = rows[0]?.stripe_subscription_id as string | null | undefined
    if (!subscriptionId) {
      return NextResponse.json({ error: "No paid plan to resume" }, { status: 400 })
    }

    const current = await stripe.subscriptions.retrieve(subscriptionId)
    if (current.status === "canceled") {
      return NextResponse.json({ error: "This plan has already ended. Choose a plan to subscribe again." }, { status: 409 })
    }
    const params = resumeParams(current)
    if (params) await stripe.subscriptions.update(subscriptionId, params)

    await ensureSubscriptionCancelAtColumn()
    // Only a row still marked to cancel changes. Whichever of this and the
    // webhook clears it first sends the admin notice, so it goes once.
    const resumed = await sql`
      UPDATE subscriptions SET cancel_at_period_end = false, cancel_at = NULL, updated_at = NOW()
      WHERE family_id = ${familyId} AND (cancel_at_period_end = true OR cancel_at IS NOT NULL)
      RETURNING tier
    `
    if (resumed.length > 0) {
      await notifyAccountChange({
        actor: user.email,
        actorType: "user",
        accountEmail: user.email,
        familyName: membership[0].family_name,
        change: "Subscription cancellation stopped",
        details: { plan: getTierDefinition(resumed[0].tier).name },
        ipAddress: requestIp(request),
      })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Resume subscription error:", error)
    return NextResponse.json({ error: "We couldn't resume your plan right now. Please try again in a minute." }, { status: 500 })
  }
}
