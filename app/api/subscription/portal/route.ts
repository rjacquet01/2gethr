import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { purchaseBlockedForRequest } from "@/lib/android-app"
import { stripe } from "@/lib/stripe"

// POST - Create a Stripe Customer Portal session so a family owner can
// self-service their subscription (update payment method, switch plans,
// view invoices, cancel) without needing an admin to process anything.
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
    const { familyId } = body

    if (!familyId) {
      return NextResponse.json({ error: "familyId required" }, { status: 400 })
    }

    // Ownership lives on families.owner_id, not on a family_members.role
    // value of "owner" — this app's roles are PARENT/CHILD, and the owner
    // is just whichever member's user_id matches the family's owner_id
    // (see app/api/families/route.ts).
    const membership = await sql`
      SELECT fm.role, f.owner_id
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

    const subscription = await sql`
      SELECT stripe_customer_id FROM subscriptions WHERE family_id = ${familyId}
    `

    const customerId = subscription[0]?.stripe_customer_id
    if (!customerId) {
      return NextResponse.json(
        { error: "No billing account found for this family yet" },
        { status: 400 }
      )
    }

    // A stored customer ID can point at a Customer that doesn't exist under
    // the currently configured Stripe account/mode (e.g. a row written
    // before this account's live-mode keys were set up, or data carried
    // over from a different Stripe account). Verify it actually resolves
    // before asking Stripe for a portal session for it — otherwise this
    // 500s with "No such customer" instead of a clear, actionable error.
    try {
      const existing = await stripe.customers.retrieve(customerId)
      if (existing.deleted) {
        return NextResponse.json(
          { error: "No billing account found for this family yet" },
          { status: 400 }
        )
      }
    } catch {
      return NextResponse.json(
        { error: "No billing account found for this family yet" },
        { status: 400 }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000"

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/subscription`,
    })

    return NextResponse.json({ success: true, url: portalSession.url })
  } catch (error) {
    console.error("Billing portal session error:", error)
    return NextResponse.json({ error: "Failed to create billing portal session" }, { status: 500 })
  }
}
