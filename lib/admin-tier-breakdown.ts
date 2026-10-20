// Admin plan breakdown: counts families by the plan the customer app treats
// them as having, so the admin numbers match what families actually get.
//
// Same rule as getFamilyPremiumAccess in lib/services/subscription.ts and
// GET /api/subscriptions: a family's plan is its most recent subscription row;
// ACTIVE or TRIALING (with an unexpired trial) keeps that row's tier, anything
// else (no row, expired trial, PAST_DUE, CANCELLED, EXPIRED) is Free.
// Trials are counted separately from paid plans rather than merged into them.
//
// No server-only imports, so the admin pages can use the label helpers too.

import { SUBSCRIPTION_TIER_KEYS, getTierDefinition, type SubscriptionTierKey } from "@/lib/subscription-tiers"

export interface LatestFamilySubscription {
  /** null when the family has no subscription row at all. */
  tier: string | null
  status: string | null
  trial_ends_at: string | Date | null
}

export interface TierCount {
  /** Families on this plan via an ACTIVE subscription. */
  paid: number
  /** Families on this plan via an unexpired TRIALING subscription. */
  trial: number
}

export type TierBreakdown = Record<SubscriptionTierKey, TierCount>

export function effectivePlan(
  sub: LatestFamilySubscription,
  now: number = Date.now()
): { tier: SubscriptionTierKey; onTrial: boolean } {
  const free = { tier: "FREE" as SubscriptionTierKey, onTrial: false }
  if (!sub.tier || !sub.status) return free
  if (sub.status === "TRIALING") {
    const trialExpired = !!sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() < now
    if (trialExpired) return free
    return { tier: getTierDefinition(sub.tier).key, onTrial: true }
  }
  if (sub.status === "ACTIVE") return { tier: getTierDefinition(sub.tier).key, onTrial: false }
  return free
}

/** One row per family (latest subscription, or nulls for none). */
export function computeTierBreakdown(rows: LatestFamilySubscription[], now: number = Date.now()): TierBreakdown {
  const out = Object.fromEntries(SUBSCRIPTION_TIER_KEYS.map((k) => [k, { paid: 0, trial: 0 }])) as TierBreakdown
  for (const row of rows) {
    const plan = effectivePlan(row, now)
    if (plan.onTrial) out[plan.tier].trial++
    else out[plan.tier].paid++
  }
  return out
}

/** Customer-facing plan name for an internal key, e.g. PREMIUM_PLUS -> "Premium". */
export function planName(tier: string | null | undefined): string {
  return getTierDefinition(tier).name
}

/** e.g. "1 paid + 2 on trial", "3 paid", "2 on trial", "0". Free has no "paid". */
export function describeTierCount(tier: SubscriptionTierKey, count: TierCount | undefined): string {
  const paid = count?.paid ?? 0
  const trial = count?.trial ?? 0
  if (tier === "FREE") return String(paid + trial)
  if (trial === 0) return paid === 0 ? "0" : `${paid} paid`
  if (paid === 0) return `${trial} on trial`
  return `${paid} paid + ${trial} on trial`
}
