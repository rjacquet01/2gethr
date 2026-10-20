// Single source of truth for subscription tier pricing, limits and feature
// flags. Previously this same data was hand-duplicated in several places and
// the copies drifted apart (different screens quoted different prices).
// Import from here instead of re-typing names or numbers.
//
// User-facing names: FREE = "Free", PREMIUM = "Plus", PREMIUM_PLUS = "Premium".
// The internal keys (and every value stored in the database) are unchanged.
//
// This file has no server-only imports (no db, no Node APIs) so it is safe
// to import from both server code (API routes, services) and client
// components ('use client' hooks and pages).

export const SUBSCRIPTION_TIER_KEYS = ["FREE", "PREMIUM", "PREMIUM_PLUS"] as const
export type SubscriptionTierKey = (typeof SUBSCRIPTION_TIER_KEYS)[number]

// Internal keys for each gated capability. UI code should check
// `tierInfo.features.<key>` (or `access.featureFlags.<key>` on the client)
// rather than comparing `tier === 'PREMIUM_PLUS'` by name, so that a tier's
// entitlements only ever need to change in one place.
export interface TierFeatureFlags {
  locationSharing: boolean
  geofencing: boolean
  advancedRecurrence: boolean
  exportCalendar: boolean
  prioritySupport: boolean
  phoneAlerts: boolean
  smsNotifications: boolean
  customReminderTimes: boolean
}

export interface TierLimits {
  maxFamilyMembers: number
  maxChildren: number // -1 = unlimited
  maxSavedPlaces: number
  maxCalendars: number
  historyDays: number
  /** Text messages per family per calendar month (urgent safety alerts are exempt). */
  smsMonthlyQuota: number
}

/**
 * Length of the free Premium trial for new families, in days. Every trial
 * length and every "N-day trial" string is built from this. Changing it only
 * affects trials started afterwards (existing rows keep their trial_ends_at).
 */
export const TRIAL_DAYS = 7

/** Text messages per month while a family is on its free trial. */
export const TRIAL_SMS_QUOTA = 10

/**
 * Shown under paid prices. Prices are set tax-inclusive in the Stripe
 * Dashboard (docs/STRIPE_TAX_SETUP.md), so the amounts above stay the same.
 */
export const PRICE_TAX_NOTE = "Price includes applicable sales tax"

/** Yearly price as a whole-percent saving over 12 monthly payments (e.g. 17). */
export function annualSavingsPercent(def: Pick<TierDefinition, "priceMonthlyCents" | "priceAnnualCents">): number {
  if (def.priceMonthlyCents <= 0) return 0
  return Math.round((1 - def.priceAnnualCents / (def.priceMonthlyCents * 12)) * 100)
}

export interface TierDefinition {
  key: SubscriptionTierKey
  name: string
  description: string
  /** Cents, to match Stripe's integer-amount convention. */
  priceMonthlyCents: number
  priceAnnualCents: number
  limits: TierLimits
  features: TierFeatureFlags
  /** Human-readable bullets shown with a checkmark on pricing/upgrade UI. */
  featureList: string[]
}

export const SUBSCRIPTION_TIERS: Record<SubscriptionTierKey, TierDefinition> = {
  FREE: {
    key: "FREE",
    name: "Free",
    description: "Basic family coordination",
    priceMonthlyCents: 0,
    priceAnnualCents: 0,
    limits: {
      maxFamilyMembers: 4,
      maxChildren: 2,
      maxSavedPlaces: 2,
      maxCalendars: 2,
      historyDays: 30,
      smsMonthlyQuota: 0,
    },
    features: {
      locationSharing: true,
      geofencing: false,
      advancedRecurrence: false,
      exportCalendar: false,
      prioritySupport: false,
      phoneAlerts: false,
      smsNotifications: false,
      customReminderTimes: false,
    },
    featureList: [
      "Up to 2 children",
      "Shared family calendar",
      "Live family location (2 saved places)",
      "Basic event notifications",
      "30 days history",
      "Email support",
    ],
  },
  PREMIUM: {
    key: "PREMIUM",
    name: "Plus",
    description: "Enhanced family features",
    priceMonthlyCents: 599, // $5.99
    priceAnnualCents: 5990, // $59.90 (17% off, about 2 months free)
    limits: {
      maxFamilyMembers: 6,
      maxChildren: 5,
      maxSavedPlaces: 15,
      maxCalendars: 5,
      historyDays: 90,
      smsMonthlyQuota: 25,
    },
    features: {
      locationSharing: true,
      geofencing: false,
      advancedRecurrence: true,
      exportCalendar: true,
      prioritySupport: true,
      phoneAlerts: false,
      smsNotifications: true,
      customReminderTimes: true,
    },
    featureList: [
      "Up to 5 children",
      "Live family location (15 saved places)",
      "Custom reminder times",
      "Complex recurring events",
      "90 days history",
      "25 text alerts/month",
      "Priority support",
    ],
  },
  PREMIUM_PLUS: {
    key: "PREMIUM_PLUS",
    name: "Premium",
    description: "Full family safety suite",
    priceMonthlyCents: 999, // $9.99
    priceAnnualCents: 9990, // $99.90 (17% off, about 2 months free)
    limits: {
      maxFamilyMembers: 12,
      maxChildren: -1, // Unlimited
      maxSavedPlaces: 50,
      maxCalendars: 20,
      historyDays: 90, // every plan is capped at 90 days (lib/retention.ts)
      smsMonthlyQuota: 100,
    },
    features: {
      locationSharing: true,
      geofencing: true,
      advancedRecurrence: true,
      exportCalendar: true,
      prioritySupport: true,
      phoneAlerts: true,
      smsNotifications: true,
      customReminderTimes: true,
    },
    featureList: [
      "Unlimited children",
      "Live family location (50 saved places)",
      "Geofence arrival & departure alerts",
      "90 days history",
      "Custom reminder times",
      "100 text alerts/month",
      "Priority support",
    ],
  },
}

export function getTierDefinition(tier: string | null | undefined): TierDefinition {
  const key = (tier || "FREE").toUpperCase() as SubscriptionTierKey
  return SUBSCRIPTION_TIERS[key] || SUBSCRIPTION_TIERS.FREE
}

/** Cents -> display dollars, e.g. 599 -> "5.99". */
export function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Ordered list of tiers, Free -> Plus -> Premium, for rendering pricing grids. */
export function listTierDefinitions(): TierDefinition[] {
  return SUBSCRIPTION_TIER_KEYS.map((key) => SUBSCRIPTION_TIERS[key])
}

/**
 * Whether a given tier includes a specific gated capability. Prefer this
 * (or the equivalent `access.featureFlags[feature]` on the client) over
 * comparing tier names directly - it keeps entitlement checks correct even
 * if a feature later moves between tiers.
 */
export function tierHasFeature(tier: string | null | undefined, feature: keyof TierFeatureFlags): boolean {
  return getTierDefinition(tier).features[feature]
}
