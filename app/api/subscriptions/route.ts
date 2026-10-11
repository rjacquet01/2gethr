import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { SUBSCRIPTION_TIERS as TIER_DEFINITIONS } from "@/lib/subscription-tiers"

// Subscription tier definitions now live in lib/subscription-tiers.ts (the
// single shared source for pricing/limits/features used by this route, the
// in-app subscription UI, and the public pricing page). Re-shaped here into
// the flatter { priceMonthly, priceYearly, features: {...limits+flags} }
// response shape the existing frontend already expects, so no API
// consumers break.
export const SUBSCRIPTION_TIERS = Object.fromEntries(
  Object.entries(TIER_DEFINITIONS).map(([key, def]) => [
    key,
    {
      name: def.name,
      description: def.description,
      priceMonthly: def.priceMonthlyCents,
      priceYearly: def.priceAnnualCents,
      features: {
        maxFamilyMembers: def.limits.maxFamilyMembers,
        maxChildren: def.limits.maxChildren,
        maxSavedPlaces: def.limits.maxSavedPlaces,
        maxCalendars: def.limits.maxCalendars,
        historyDays: def.limits.historyDays,
        ...def.features,
      },
      featureList: def.featureList,
    },
  ])
) as Record<string, {
  name: string
  description: string
  priceMonthly: number
  priceYearly: number
  features: Record<string, number | boolean>
  featureList: string[]
}>

// Get current family subscription
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const familyId = request.nextUrl.searchParams.get("familyId") || user.primaryFamily?.id

    if (!familyId) {
      return NextResponse.json(
        { success: false, error: "No family specified" },
        { status: 400 }
      )
    }

    // Verify user is in the family
    const membership = await sql`
      SELECT role FROM family_members 
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json(
        { success: false, error: "Not a member of this family" },
        { status: 403 }
      )
    }

    // Get subscription
    const subscriptions = await sql`
      SELECT 
        s.*,
        f.name as family_name, f.owner_id
      FROM subscriptions s
      JOIN families f ON s.family_id = f.id
      WHERE s.family_id = ${familyId}
      ORDER BY s.created_at DESC
      LIMIT 1
    `

    if (subscriptions.length === 0) {
      // Return free tier info
      return NextResponse.json({
        success: true,
        data: {
          tier: "FREE",
          status: "ACTIVE",
          tierInfo: SUBSCRIPTION_TIERS.FREE,
          familyId,
          isOwner: user.primaryFamily?.ownerId === user.id,
        },
      })
    }

    const subscription = subscriptions[0]

    // An expired trial is Free, matching checkFamilySubscription in lib/auth.ts,
    // even if the row still says TRIALING.
    const trialExpired =
      subscription.status === "TRIALING" &&
      !!subscription.trial_ends_at &&
      new Date(subscription.trial_ends_at).getTime() < Date.now()
    if (trialExpired) {
      return NextResponse.json({
        success: true,
        data: {
          tier: "FREE",
          status: "ACTIVE",
          tierInfo: SUBSCRIPTION_TIERS.FREE,
          familyId,
          isOwner: subscription.owner_id === user.id,
        },
      })
    }

    const tierInfo = SUBSCRIPTION_TIERS[subscription.tier as keyof typeof SUBSCRIPTION_TIERS] || SUBSCRIPTION_TIERS.FREE

    return NextResponse.json({
      success: true,
      data: {
        id: subscription.id,
        tier: subscription.tier,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        trialEndsAt: subscription.trial_ends_at,
        tierInfo,
        familyId,
        familyName: subscription.family_name,
        isOwner: subscription.owner_id === user.id,
        stripeCustomerId: membership[0].role === "PARENT" ? subscription.stripe_customer_id : null,
      },
    })
  } catch (error) {
    console.error("Get subscription error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get subscription" },
      { status: 500 }
    )
  }
}

// Get all available subscription plans
export async function OPTIONS() {
  return NextResponse.json({
    success: true,
    data: {
      plans: Object.entries(SUBSCRIPTION_TIERS).map(([key, value]) => ({
        tier: key,
        ...value,
      })),
    },
  })
}
