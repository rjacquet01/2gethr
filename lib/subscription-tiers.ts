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
  /** Saved places that can have arrival/departure alerts on (-1 = all of them). */
  maxAlertPlaces: number
  maxCalendars: number
  /** Days of past calendar events and task/reminder archives kept visible. */
  historyDays: number
  /** Days of location trail (past positions) kept and shown; 0 = latest point only. */
  locationTrailDays: number
  /** Text messages per family per calendar month (urgent safety alerts are exempt). */
  smsMonthlyQuota: number
  /** Family members sharing live location at the same time (-1 = everyone). */
  maxLocationSharers: number
  /** Upcoming reminders (not yet fired) per family (-1 = unlimited). */
  maxActiveReminders: number
  /** Calendar events created per family per calendar month (-1 = unlimited). */
  maxEventsPerMonth: number
  /** Photo/flyer uploads kept on the family board, including restorable taken-down ones. */
  maxBoardUploads: number
  /** Routine push notifications per family per calendar month (-1 = unlimited; safety alerts never count). */
  pushMonthlyQuota: number
}

// Plan caps for Free / Plus / Premium, kept here so they can be tuned in one
// place. -1 means unlimited. Enforced server-side by lib/tier-limits.ts.
// Free 3: a parent plus the plan's 2 children (children count as sharers).
export const LOCATION_SHARERS = { FREE: 3, PLUS: 4, PREMIUM: -1 } as const
export const ACTIVE_REMINDERS = { FREE: 5, PLUS: 30, PREMIUM: -1 } as const
export const EVENTS_PER_MONTH = { FREE: 15, PLUS: 100, PREMIUM: -1 } as const
export const BOARD_UPLOADS = { FREE: 3, PLUS: 25, PREMIUM: 100 } as const
export const ROUTINE_PUSH_PER_MONTH = { FREE: 100, PLUS: 1000, PREMIUM: -1 } as const
/** Past calendar events and task/reminder archives. */
export const HISTORY_DAYS = { FREE: 30, PLUS: 90, PREMIUM: 90 } as const
/** Location trail (past positions). Free has none: only the latest point is kept. */
export const LOCATION_TRAIL_DAYS = { FREE: 0, PLUS: 90, PREMIUM: 90 } as const
/** Text messages a month (opt-in; urgent safety alerts don't count). */
export const SMS_PER_MONTH = { FREE: 0, PLUS: 25, PREMIUM: 100 } as const
/** Show a soft "nearly at your limit" nudge from this share of a cap. */
export const NEAR_LIMIT_RATIO = 0.8

/**
 * Length of the free Premium trial for new families, in days. Every trial
 * length and every "N-day trial" string is built from this. Changing it only
 * affects trials started afterwards (existing rows keep their trial_ends_at).
 */
export const TRIAL_DAYS = 7

/** Text messages per month while a family is on its free trial. */
export const TRIAL_SMS_QUOTA = 10

/**
 * Shown under paid prices only once Stripe Tax is on (STRIPE_TAX_ENABLED,
 * passed to the browser by next.config.mjs at build time); until then nothing.
 */
export function priceTaxNote(): string {
  return process.env.NEXT_PUBLIC_STRIPE_TAX_ENABLED === "true" ? "Taxes calculated at checkout" : ""
}

/** Plan bullet for a plan's monthly text allowance. */
export function textAlertsBullet(quota: number): string {
  return `${quota} text alerts a month (opt-in; urgent safety alerts don't count)`
}

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
      maxAlertPlaces: 0,
      maxCalendars: 2,
      historyDays: HISTORY_DAYS.FREE,
      locationTrailDays: LOCATION_TRAIL_DAYS.FREE,
      smsMonthlyQuota: SMS_PER_MONTH.FREE,
      maxLocationSharers: LOCATION_SHARERS.FREE,
      maxActiveReminders: ACTIVE_REMINDERS.FREE,
      maxEventsPerMonth: EVENTS_PER_MONTH.FREE,
      maxBoardUploads: BOARD_UPLOADS.FREE,
      pushMonthlyQuota: ROUTINE_PUSH_PER_MONTH.FREE,
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
      `Shared family calendar (${EVENTS_PER_MONTH.FREE} new events a month)`,
      `Live family location (${LOCATION_SHARERS.FREE} members at once, 2 saved places)`,
      `${ACTIVE_REMINDERS.FREE} active reminders`,
      `${BOARD_UPLOADS.FREE} photo uploads on the family board`,
      `${ROUTINE_PUSH_PER_MONTH.FREE} notifications a month (safety alerts always arrive)`,
      `${HISTORY_DAYS.FREE} days of past events`,
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
      maxAlertPlaces: 3,
      maxCalendars: 5,
      historyDays: HISTORY_DAYS.PLUS,
      locationTrailDays: LOCATION_TRAIL_DAYS.PLUS,
      smsMonthlyQuota: SMS_PER_MONTH.PLUS,
      maxLocationSharers: LOCATION_SHARERS.PLUS,
      maxActiveReminders: ACTIVE_REMINDERS.PLUS,
      maxEventsPerMonth: EVENTS_PER_MONTH.PLUS,
      maxBoardUploads: BOARD_UPLOADS.PLUS,
      pushMonthlyQuota: ROUTINE_PUSH_PER_MONTH.PLUS,
    },
    features: {
      locationSharing: true,
      geofencing: true, // on up to maxAlertPlaces places
      advancedRecurrence: true,
      exportCalendar: true,
      prioritySupport: true,
      phoneAlerts: false,
      smsNotifications: true,
      customReminderTimes: true,
    },
    featureList: [
      "Up to 5 children",
      `Live location for ${LOCATION_SHARERS.PLUS} family members (15 saved places)`,
      "Arrival & departure alerts (3 places)",
      `${EVENTS_PER_MONTH.PLUS} new events a month, ${ACTIVE_REMINDERS.PLUS} active reminders`,
      `${BOARD_UPLOADS.PLUS} photo uploads on the family board`,
      `${ROUTINE_PUSH_PER_MONTH.PLUS.toLocaleString("en-US")} notifications a month (safety alerts always arrive)`,
      "Custom reminder times",
      "Complex recurring events",
      `${LOCATION_TRAIL_DAYS.PLUS}-day location trail, ${HISTORY_DAYS.PLUS} days of past events`,
      textAlertsBullet(SMS_PER_MONTH.PLUS),
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
      maxAlertPlaces: -1, // every saved place
      maxCalendars: 20,
      historyDays: HISTORY_DAYS.PREMIUM, // every plan is capped at 90 days (lib/retention.ts)
      locationTrailDays: LOCATION_TRAIL_DAYS.PREMIUM,
      smsMonthlyQuota: SMS_PER_MONTH.PREMIUM,
      maxLocationSharers: LOCATION_SHARERS.PREMIUM,
      maxActiveReminders: ACTIVE_REMINDERS.PREMIUM,
      maxEventsPerMonth: EVENTS_PER_MONTH.PREMIUM,
      maxBoardUploads: BOARD_UPLOADS.PREMIUM,
      pushMonthlyQuota: ROUTINE_PUSH_PER_MONTH.PREMIUM,
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
      "Live location for the whole family (50 saved places)",
      "Arrival & departure alerts (every place)",
      "Unlimited events, reminders and notifications",
      `${BOARD_UPLOADS.PREMIUM} photo uploads on the family board`,
      "Emergency alerts to your child",
      `${LOCATION_TRAIL_DAYS.PREMIUM}-day location trail, ${HISTORY_DAYS.PREMIUM} days of past events`,
      "Custom reminder times",
      textAlertsBullet(SMS_PER_MONTH.PREMIUM),
      "Priority support",
    ],
  },
}

export function getTierDefinition(tier: string | null | undefined): TierDefinition {
  const key = (tier || "FREE").toUpperCase() as SubscriptionTierKey
  return SUBSCRIPTION_TIERS[key] || SUBSCRIPTION_TIERS.FREE
}

/** How many saved places may have arrival/departure alerts on: null = every place, 0 = none. */
export function alertPlaceLimit(tier: string | null | undefined): number | null {
  const def = getTierDefinition(tier)
  if (!def.features.geofencing) return 0
  const n = def.limits.maxAlertPlaces
  return n < 0 ? null : n
}

/** Cents -> display dollars, e.g. 599 -> "5.99". */
export function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * How a plan's price is shown on the home page, /pricing, /subscription and the
 * upgrade page. Annual shows the yearly amount; the per-month figure only ever
 * appears as "about $X/month, billed annually", never as a bare monthly price.
 */
export function displayPrice(
  def: Pick<TierDefinition, "priceMonthlyCents" | "priceAnnualCents">,
  cycle: "monthly" | "annual"
): { main: string; unit: string; sub: string } {
  if (def.priceMonthlyCents <= 0) return { main: "$0", unit: "/month", sub: "" }
  if (cycle === "monthly") return { main: `$${centsToDisplay(def.priceMonthlyCents)}`, unit: "/month", sub: "" }
  return {
    main: `$${centsToDisplay(def.priceAnnualCents)}`,
    unit: "/year",
    sub: `about $${centsToDisplay(Math.round(def.priceAnnualCents / 12))}/month, billed annually`,
  }
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
