import {
  getTierDefinition,
  NEAR_LIMIT_RATIO,
  SUBSCRIPTION_TIER_KEYS,
  type SubscriptionTierKey,
  type TierLimits,
} from "./subscription-tiers"

// The plan-cap rules and wording, with no server imports so pages can use
// them too. The checks against the database are in lib/tier-limits.ts.

export type PlanLimitKind = "locationSharers" | "activeReminders" | "eventsPerMonth" | "boardUploads" | "routinePush"

const LIMIT_FIELD: Record<PlanLimitKind, keyof TierLimits> = {
  locationSharers: "maxLocationSharers",
  activeReminders: "maxActiveReminders",
  eventsPerMonth: "maxEventsPerMonth",
  boardUploads: "maxBoardUploads",
  routinePush: "pushMonthlyQuota",
}

export interface PlanLimitResult {
  kind: PlanLimitKind
  allowed: boolean
  used: number
  /** null = unlimited */
  limit: number | null
  /** Tier whose caps apply (PREMIUM_PLUS during a trial). */
  tier: SubscriptionTierKey
  trial: boolean
  /** The next plan up that raises this cap, or null when none does. */
  upgradeTo: { key: SubscriptionTierKey; name: string; limit: number | null } | null
}

/** A cap from a tier's limits: null = unlimited. */
export function capFor(tier: string, kind: PlanLimitKind): number | null {
  const n = getTierDefinition(tier).limits[LIMIT_FIELD[kind]]
  return n < 0 ? null : n
}

/** The decision for `used` items against a tier's cap. */
export function evaluateLimit(kind: PlanLimitKind, tier: SubscriptionTierKey, trial: boolean, used: number): PlanLimitResult {
  const limit = capFor(tier, kind)
  let upgradeTo: PlanLimitResult["upgradeTo"] = null
  for (const key of SUBSCRIPTION_TIER_KEYS.slice(SUBSCRIPTION_TIER_KEYS.indexOf(tier) + 1)) {
    const next = capFor(key, kind)
    if (limit !== null && (next === null || next > limit)) {
      upgradeTo = { key, name: getTierDefinition(key).name, limit: next }
      break
    }
  }
  return { kind, allowed: limit === null || used < limit, used, limit, tier, trial, upgradeTo }
}

/** Whether to show the soft "nearly at your limit" nudge (from NEAR_LIMIT_RATIO of the cap). */
export function isNearLimit(r: { used: number; limit: number | null }): boolean {
  return r.limit !== null && r.limit > 0 && r.used >= Math.ceil(r.limit * NEAR_LIMIT_RATIO)
}

const NOUN: Record<PlanLimitKind, { used: (n: number, of: number | null) => string; more: (n: number | null) => string }> = {
  eventsPerMonth: {
    used: (n, of) => `You've used ${n} of ${of} events this month.`,
    more: (n) => (n === null ? "unlimited events" : `${n} a month`),
  },
  activeReminders: {
    used: (n, of) => `You have ${n} of ${of} active reminders.`,
    more: (n) => (n === null ? "unlimited reminders" : `up to ${n}`),
  },
  boardUploads: {
    used: (n, of) => `Your board has ${n} of ${of} photo uploads.`,
    more: (n) => (n === null ? "unlimited uploads" : `${n} uploads`),
  },
  locationSharers: {
    used: (n, of) => `${n} of ${of} family members are sharing live location.`,
    more: (n) => (n === null ? "live location for the whole family" : `${n} at once`),
  },
  routinePush: {
    used: (n, of) => `Your family has used ${n} of ${of} notifications this month.`,
    more: (n) => (n === null ? "unlimited notifications" : `${n.toLocaleString("en-US")} a month`),
  },
}

/** Neutral copy for the Android app, where Google Play rules out prices and upgrade links. */
export const IN_APP_LIMIT_COPY = "You've reached your plan's limit. Manage your plan at mytogethr.com"
/** Where plan details would go, inside the Android app. */
export const IN_APP_PLANS_COPY = "Manage your plan at mytogethr.com"
export const IN_APP_NEAR_LIMIT_COPY = "You're close to your plan's limit. Manage your plan at mytogethr.com"

/** "You've used 9 of 15 events this month." */
export function planUsageLine(r: Pick<PlanLimitResult, "kind" | "used" | "limit">): string {
  return NOUN[r.kind].used(r.used, r.limit)
}

/**
 * What to tell someone at a cap. `inApp`: inside the Android app, so no plan
 * to buy, no prices and no upgrade wording.
 */
export function planLimitMessage(
  r: Pick<PlanLimitResult, "kind" | "used" | "limit" | "trial" | "upgradeTo">,
  opts: { inApp?: boolean } = {}
): string {
  const used = planUsageLine(r)
  if (opts.inApp) return `${used} ${IN_APP_LIMIT_COPY}`
  if (r.trial) return `${used} That's the most your trial allows.`
  if (!r.upgradeTo) return `${used} That's the most any plan allows.`
  const verb = r.upgradeTo.limit === null ? "includes" : "adds"
  return `${used} ${r.upgradeTo.name} ${verb} ${NOUN[r.kind].more(r.upgradeTo.limit)}.`
}

export interface PlanLimitBody {
  success: false
  error: string
  code: "PLAN_LIMIT"
  limit: {
    kind: PlanLimitKind
    used: number
    limit: number | null
    upgradeTo: PlanLimitResult["upgradeTo"]
  }
}

/** The JSON a route returns for a request over a cap (HTTP 402). */
export function planLimitBody(r: PlanLimitResult, opts: { inApp?: boolean } = {}): PlanLimitBody {
  return {
    success: false,
    error: planLimitMessage(r, opts),
    code: "PLAN_LIMIT",
    limit: { kind: r.kind, used: r.used, limit: r.limit, upgradeTo: opts.inApp ? null : r.upgradeTo },
  }
}

// Notification types whose push counts toward the monthly quota. Everything
// else (geofence, SOS, emergency, location, approval requests, invites,
// account and legal notices) is a safety or account message and never counts.
const ROUTINE_PUSH_TYPES = new Set([
  "REMINDER",
  "EVENT_REMINDER",
  "EVENT_INVITATION",
  "EVENT_UPDATE",
  "EVENT_APPROVED",
  "EVENT_REJECTED",
  "EVENT_CREATED",
  "TASK_ASSIGNED",
  "TASK_COMPLETED",
  "TASK_OVERDUE",
  "TASK_COMMENT",
  "APPROVAL_RESPONSE",
])

/** Whether a notification's push is routine (counted) rather than safety (never capped). */
export function isRoutinePush(type: string, data?: Record<string, unknown> | null): boolean {
  if (type === "SYSTEM") return data?.subType === "BOARD_POST"
  return ROUTINE_PUSH_TYPES.has(type)
}
