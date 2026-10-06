import { sql } from '@/lib/db'
import { SUBSCRIPTION_TIERS as TIER_DEFINITIONS, getTierDefinition } from '@/lib/subscription-tiers'

// Local enums to match database
const SubscriptionTier = {
  FREE: "FREE",
  PREMIUM: "PREMIUM",
  PREMIUM_PLUS: "PREMIUM_PLUS",
} as const

const SubscriptionStatus = {
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  TRIALING: "TRIALING",
} as const

// Premium feature definitions
export const PREMIUM_FEATURES = {
  UNLIMITED_CHILDREN: "unlimited_children",
  ADVANCED_REMINDERS: "advanced_reminders",
  CUSTOM_REMINDER_TIMES: "custom_reminder_times",
  LOCATION_SHARING: "location_sharing",
  GEOFENCE_ALERTS: "geofence_alerts",
  ADVANCED_RECURRING: "advanced_recurring",
  EXTENDED_HISTORY: "extended_history",
  PHONE_ALERTS: "phone_alerts",
  SMS_NOTIFICATIONS: "sms_notifications",
} as const

// Feature access by tier, derived from the shared tier definitions in
// lib/subscription-tiers.ts (rather than a second hand-maintained copy) so
// this stays in sync with what the pricing page and in-app subscription UI
// actually advertise. Maps each tier's boolean feature flags onto the
// PREMIUM_FEATURES string keys that canUsePremiumFeature() checks against.
function deriveTierFeatureKeys(tier: string): string[] {
  const def = getTierDefinition(tier)
  const keys: string[] = []
  if (def.limits.maxChildren === -1) keys.push(PREMIUM_FEATURES.UNLIMITED_CHILDREN)
  if (def.features.advancedRecurrence) keys.push(PREMIUM_FEATURES.ADVANCED_REMINDERS, PREMIUM_FEATURES.ADVANCED_RECURRING)
  if (def.features.customReminderTimes) keys.push(PREMIUM_FEATURES.CUSTOM_REMINDER_TIMES)
  if (def.features.locationSharing) keys.push(PREMIUM_FEATURES.LOCATION_SHARING)
  if (def.features.geofencing) keys.push(PREMIUM_FEATURES.GEOFENCE_ALERTS)
  if (def.limits.historyDays >= 365) keys.push(PREMIUM_FEATURES.EXTENDED_HISTORY)
  if (def.features.phoneAlerts) keys.push(PREMIUM_FEATURES.PHONE_ALERTS)
  if (def.features.smsNotifications) keys.push(PREMIUM_FEATURES.SMS_NOTIFICATIONS)
  return keys
}

const TIER_FEATURES: Record<string, string[]> = {
  [SubscriptionTier.FREE]: deriveTierFeatureKeys(SubscriptionTier.FREE),
  [SubscriptionTier.PREMIUM]: deriveTierFeatureKeys(SubscriptionTier.PREMIUM),
  [SubscriptionTier.PREMIUM_PLUS]: deriveTierFeatureKeys(SubscriptionTier.PREMIUM_PLUS),
}

// Tier limits
const TIER_LIMITS = {
  [SubscriptionTier.FREE]: { maxChildren: TIER_DEFINITIONS.FREE.limits.maxChildren, historyDays: TIER_DEFINITIONS.FREE.limits.historyDays },
  [SubscriptionTier.PREMIUM]: { maxChildren: TIER_DEFINITIONS.PREMIUM.limits.maxChildren, historyDays: TIER_DEFINITIONS.PREMIUM.limits.historyDays },
  [SubscriptionTier.PREMIUM_PLUS]: { maxChildren: TIER_DEFINITIONS.PREMIUM_PLUS.limits.maxChildren, historyDays: TIER_DEFINITIONS.PREMIUM_PLUS.limits.historyDays }, // -1 = unlimited
}

export interface SubscriptionInfo {
  id: string
  familyId: string
  tier: string
  status: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  trialEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export interface GooglePlayPurchase {
  purchaseToken: string
  productId: string
  purchaseTime: number
  expiryTime?: number
  autoRenewing?: boolean
  acknowledged?: boolean
}

/**
 * Get family subscription info
 */
export async function getFamilySubscription(familyId: string): Promise<SubscriptionInfo | null> {
  const result = await sql`
    SELECT id, family_id, tier, status, current_period_start, current_period_end,
           trial_ends_at, cancel_at_period_end
    FROM subscriptions
    WHERE family_id = ${familyId}
    ORDER BY created_at DESC
    LIMIT 1
  `
  
  if (result.length === 0) return null
  
  const sub = result[0]
  return {
    id: sub.id,
    familyId: sub.family_id,
    tier: sub.tier,
    status: sub.status,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    trialEnd: sub.trial_ends_at,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
}

/**
 * Check if family has premium access (active subscription)
 */
export async function getFamilyPremiumAccess(familyId: string): Promise<{
  hasPremium: boolean
  tier: string
  features: string[]
  limits: { maxChildren: number; historyDays: number }
}> {
  const subscription = await getFamilySubscription(familyId)
  
  if (!subscription) {
    return {
      hasPremium: false,
      tier: SubscriptionTier.FREE,
      features: TIER_FEATURES[SubscriptionTier.FREE],
      limits: TIER_LIMITS[SubscriptionTier.FREE],
    }
  }
  
  const trialExpired =
    subscription.status === SubscriptionStatus.TRIALING &&
    !!subscription.trialEnd &&
    new Date(subscription.trialEnd).getTime() < Date.now()
  const isActive =
    (subscription.status === SubscriptionStatus.ACTIVE ||
      subscription.status === SubscriptionStatus.TRIALING) &&
    !trialExpired
  
  const effectiveTier = isActive ? subscription.tier : SubscriptionTier.FREE
  
  return {
    hasPremium: isActive && effectiveTier !== SubscriptionTier.FREE,
    tier: effectiveTier,
    features: TIER_FEATURES[effectiveTier] || [],
    limits: TIER_LIMITS[effectiveTier] || TIER_LIMITS[SubscriptionTier.FREE],
  }
}

/**
 * Check if a specific premium feature is available
 */
export async function canUsePremiumFeature(
  familyId: string,
  feature: string
): Promise<boolean> {
  const access = await getFamilyPremiumAccess(familyId)
  return access.features.includes(feature)
}

/**
 * Check if family can add more children
 */
export async function canAddChild(familyId: string): Promise<{
  allowed: boolean
  currentCount: number
  maxAllowed: number
}> {
  const access = await getFamilyPremiumAccess(familyId)
  
  const countResult = await sql`
    SELECT COUNT(*) as count
    FROM child_profiles cp
    JOIN family_members fm ON cp.family_member_id = fm.id
    WHERE fm.family_id = ${familyId}
  `
  
  const currentCount = parseInt(countResult[0].count, 10)
  const maxAllowed = access.limits.maxChildren
  
  return {
    allowed: maxAllowed === -1 || currentCount < maxAllowed,
    currentCount,
    maxAllowed: maxAllowed === -1 ? Infinity : maxAllowed,
  }
}

/**
 * Normalize Google Play subscription to internal status
 */
export function normalizeSubscriptionStatus(
  purchase: GooglePlayPurchase
): { tier: string; status: string; periodEnd: Date | null } {
  const now = Date.now()
  
  // Determine tier from product ID
  let tier = SubscriptionTier.FREE
  if (purchase.productId.includes("premium_plus")) {
    tier = SubscriptionTier.PREMIUM_PLUS
  } else if (purchase.productId.includes("premium")) {
    tier = SubscriptionTier.PREMIUM
  }
  
  // Determine status
  let status = SubscriptionStatus.ACTIVE
  const expiryTime = purchase.expiryTime || 0
  
  if (expiryTime && expiryTime < now) {
    status = SubscriptionStatus.EXPIRED
    tier = SubscriptionTier.FREE
  } else if (!purchase.autoRenewing) {
    status = SubscriptionStatus.CANCELLED
  }
  
  return {
    tier,
    status,
    periodEnd: expiryTime ? new Date(expiryTime) : null,
  }
}

/**
 * Verify Google Play subscription (abstraction - actual implementation requires Google Play API)
 */
export async function verifyGooglePlaySubscription(
  purchaseToken: string,
  productId: string
): Promise<GooglePlayPurchase | null> {
  // This is an abstraction layer - actual implementation would call Google Play Developer API
  // For now, return mock data structure
  
  // In production, you would:
  // 1. Call Google Play Developer API with the purchase token
  // 2. Validate the response
  // 3. Return normalized purchase data
  
  console.log('[v0] Google Play verification would happen here for:', { purchaseToken, productId })
  
  // Return null to indicate verification not implemented
  // In production, this would return the actual purchase data
  return null
}

/**
 * Sync subscription from external provider
 */
export async function syncSubscription(
  familyId: string,
  userId: string,
  purchase: GooglePlayPurchase
): Promise<SubscriptionInfo> {
  const normalized = normalizeSubscriptionStatus(purchase)
  
  // Check for existing subscription
  const existing = await getFamilySubscription(familyId)
  
  if (existing) {
    // Update existing subscription
    const result = await sql`
      UPDATE subscriptions
      SET tier = ${normalized.tier},
          status = ${normalized.status},
          current_period_end = ${normalized.periodEnd},
          external_subscription_id = ${purchase.purchaseToken},
          cancel_at_period_end = ${!purchase.autoRenewing},
          updated_at = NOW()
      WHERE id = ${existing.id}
      RETURNING id, family_id, tier, status, current_period_start, current_period_end,
                trial_ends_at, cancel_at_period_end
    `
    
    // Audit log
    await sql`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
      VALUES (
        ${userId}, 
        'SUBSCRIPTION_CHANGE', 
        'subscription',
        ${existing.id},
        ${JSON.stringify({ tier: existing.tier })},
        ${JSON.stringify({ tier: normalized.tier, status: normalized.status })}
      )
    `
    
    const sub = result[0]
    return {
      id: sub.id,
      familyId: sub.family_id,
      tier: sub.tier,
      status: sub.status,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      trialEnd: sub.trial_ends_at,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }
  } else {
    // Create new subscription
    const result = await sql`
      INSERT INTO subscriptions (family_id, tier, status, current_period_start, current_period_end,
                                 external_subscription_id, cancel_at_period_end)
      VALUES (${familyId}, ${normalized.tier}, ${normalized.status}, NOW(), ${normalized.periodEnd},
              ${purchase.purchaseToken}, ${!purchase.autoRenewing})
      RETURNING id, family_id, tier, status, current_period_start, current_period_end,
                trial_ends_at, cancel_at_period_end
    `
    
    // Audit log
    await sql`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
      VALUES (
        ${userId}, 
        'SUBSCRIPTION_CHANGE', 
        'subscription',
        ${result[0].id},
        ${JSON.stringify({ tier: normalized.tier, status: normalized.status })}
      )
    `
    
    const sub = result[0]
    return {
      id: sub.id,
      familyId: sub.family_id,
      tier: sub.tier,
      status: sub.status,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      trialEnd: sub.trial_ends_at,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }
  }
}

/**
 * Start a free trial
 */
export async function startFreeTrial(
  familyId: string,
  userId: string,
  trialDays: number = 30
): Promise<SubscriptionInfo> {
  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + trialDays)
  
  const result = await sql`
    INSERT INTO subscriptions (family_id, tier, status, trial_ends_at, current_period_start, current_period_end)
    VALUES (${familyId}, ${SubscriptionTier.PREMIUM}, ${SubscriptionStatus.TRIALING}, ${trialEnd}, NOW(), ${trialEnd})
    ON CONFLICT (family_id) DO UPDATE
    SET tier = ${SubscriptionTier.PREMIUM},
        status = ${SubscriptionStatus.TRIALING},
        trial_ends_at = ${trialEnd},
        current_period_end = ${trialEnd},
        updated_at = NOW()
    RETURNING id, family_id, tier, status, current_period_start, current_period_end,
              trial_ends_at, cancel_at_period_end
  `
  
  // Audit log
  await sql`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
    VALUES (
      ${userId}, 
      'SUBSCRIPTION_CHANGE', 
      'subscription',
      ${result[0].id},
      ${JSON.stringify({ action: 'trial_started', trialDays, trialEnd: trialEnd.toISOString() })}
    )
  `
  
  const sub = result[0]
  return {
    id: sub.id,
    familyId: sub.family_id,
    tier: sub.tier,
    status: sub.status,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    trialEnd: sub.trial_ends_at,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
}

/**
 * Get subscription tier display info
 */
export function getSubscriptionTierInfo(tier: string) {
  const def = getTierDefinition(tier)
  return {
    name: def.name,
    description: def.description,
    price: { monthly: def.priceMonthlyCents / 100, annual: def.priceAnnualCents / 100 },
    features: def.featureList,
  }
}
