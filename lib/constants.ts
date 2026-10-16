// Safe Link - Application Constants

import { SubscriptionTier, type SubscriptionFeatures, type SubscriptionPlan } from "./types"
import { SUBSCRIPTION_TIERS as SUBSCRIPTION_TIER_DEFS } from "./subscription-tiers"

// ============================================
// AUTH CONSTANTS
// ============================================

export const AUTH = {
  ACCESS_TOKEN_EXPIRY: "15m",
  REFRESH_TOKEN_EXPIRY: "7d",
  ACCESS_TOKEN_EXPIRY_SECONDS: 15 * 60, // 15 minutes
  REFRESH_TOKEN_EXPIRY_SECONDS: 7 * 24 * 60 * 60, // 7 days
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  BCRYPT_ROUNDS: 12,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 15,
} as const

// ============================================
// FAMILY CONSTANTS
// ============================================

export const FAMILY = {
  INVITE_CODE_EXPIRY_HOURS: 48,
  MAX_MEMBERS_FREE: 5,
  MAX_MEMBERS_PREMIUM: 15,
  MAX_MEMBERS_PREMIUM_PLUS: 30,
  DEFAULT_CALENDAR_COLOR: "#3B82F6",
} as const

// ============================================
// EVENT CONSTANTS
// ============================================

export const EVENT = {
  MAX_TITLE_LENGTH: 200,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_PARTICIPANTS: 50,
  DEFAULT_REMINDER_MINUTES: [15, 60],
  MAX_RECURRENCE_OCCURRENCES: 365,
  CONFLICT_CHECK_DAYS_AHEAD: 90,
} as const

// ============================================
// LOCATION CONSTANTS
// ============================================

export const LOCATION = {
  DEFAULT_UPDATE_INTERVAL_SEC: 300, // 5 minutes
  MIN_UPDATE_INTERVAL_SEC: 60, // 1 minute
  MAX_UPDATE_INTERVAL_SEC: 3600, // 1 hour
  DEFAULT_GEOFENCE_RADIUS_METERS: 100,
  MIN_GEOFENCE_RADIUS_METERS: 50,
  MAX_GEOFENCE_RADIUS_METERS: 5000,
  PING_RETENTION_DAYS: 30,
  MAX_SAVED_PLACES_FREE: 3,
  MAX_SAVED_PLACES_PREMIUM: 20,
  MAX_SAVED_PLACES_PREMIUM_PLUS: 50,
} as const

// ============================================
// NOTIFICATION CONSTANTS
// ============================================

export const NOTIFICATION = {
  MAX_UNREAD: 100,
  RETENTION_DAYS: 90,
  BATCH_SIZE: 50,
} as const

// ============================================
// SUBSCRIPTION PLANS
// ============================================

// Derived from lib/subscription-tiers.ts (the single source of truth for
// names, prices, limits and feature flags) so these can never disagree with
// what the pricing, subscription and upgrade pages show.
const planFromTier = (tier: SubscriptionTier): SubscriptionPlan => {
  const def = SUBSCRIPTION_TIER_DEFS[tier]
  return {
    tier,
    name: def.name,
    description: def.description,
    priceMonthly: def.priceMonthlyCents,
    priceYearly: def.priceAnnualCents,
    features: [...def.featureList],
  }
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionTier, SubscriptionPlan> = {
  FREE: planFromTier(SubscriptionTier.FREE),
  PREMIUM: planFromTier(SubscriptionTier.PREMIUM),
  PREMIUM_PLUS: planFromTier(SubscriptionTier.PREMIUM_PLUS),
}

const featuresFromTier = (tier: SubscriptionTier): SubscriptionFeatures => {
  const def = SUBSCRIPTION_TIER_DEFS[tier]
  return {
    maxFamilyMembers: def.limits.maxFamilyMembers,
    maxSavedPlaces: def.limits.maxSavedPlaces,
    maxCalendars: def.limits.maxCalendars,
    locationSharing: def.features.locationSharing,
    geofencing: def.features.geofencing,
    advancedRecurrence: def.features.advancedRecurrence,
    exportCalendar: def.features.exportCalendar,
    prioritySupport: def.features.prioritySupport,
  }
}

export const SUBSCRIPTION_FEATURES: Record<SubscriptionTier, SubscriptionFeatures> = {
  FREE: featuresFromTier(SubscriptionTier.FREE),
  PREMIUM: featuresFromTier(SubscriptionTier.PREMIUM),
  PREMIUM_PLUS: featuresFromTier(SubscriptionTier.PREMIUM_PLUS),
}

// ============================================
// FILE UPLOAD CONSTANTS
// ============================================

export const UPLOAD = {
  MAX_PROFILE_PHOTO_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  PROFILE_PHOTO_PATH_PREFIX: "profile-photos",
} as const

// ============================================
// API CONSTANTS
// ============================================

export const API = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  RATE_LIMIT_REQUESTS: 100,
  RATE_LIMIT_WINDOW_SECONDS: 60,
} as const

// ============================================
// ERROR CODES
// ============================================

export const ERROR_CODES = {
  // Auth errors
  INVALID_CREDENTIALS: "AUTH_001",
  TOKEN_EXPIRED: "AUTH_002",
  TOKEN_INVALID: "AUTH_003",
  ACCOUNT_LOCKED: "AUTH_004",
  EMAIL_NOT_VERIFIED: "AUTH_005",
  
  // Family errors
  FAMILY_NOT_FOUND: "FAMILY_001",
  NOT_FAMILY_MEMBER: "FAMILY_002",
  INSUFFICIENT_PERMISSIONS: "FAMILY_003",
  INVITE_EXPIRED: "FAMILY_004",
  MEMBER_LIMIT_REACHED: "FAMILY_005",
  
  // Event errors
  EVENT_NOT_FOUND: "EVENT_001",
  EVENT_CONFLICT: "EVENT_002",
  APPROVAL_REQUIRED: "EVENT_003",
  CANNOT_OVERRIDE_CONFLICT: "EVENT_004",
  
  // Location errors
  LOCATION_SHARING_DISABLED: "LOC_001",
  GEOFENCE_NOT_ENABLED: "LOC_002",
  PLACE_LIMIT_REACHED: "LOC_003",
  
  // Subscription errors
  SUBSCRIPTION_REQUIRED: "SUB_001",
  FEATURE_NOT_AVAILABLE: "SUB_002",
  PAYMENT_FAILED: "SUB_003",
  
  // General errors
  VALIDATION_ERROR: "GEN_001",
  NOT_FOUND: "GEN_002",
  INTERNAL_ERROR: "GEN_003",
  RATE_LIMITED: "GEN_004",
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
