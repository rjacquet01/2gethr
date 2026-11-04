import { sql } from "./db"
import { ddl } from "./schema-snapshot"
import { getTierDefinition, type SubscriptionTierKey } from "./subscription-tiers"
import { trialBlockedByStripe } from "./trial-eligibility"

// Extended trials: a free Plus or Premium trial an admin grants a family (for
// example Play closed-test testers), any length up to a year, regardless of
// the once-a-year trial rule. Stored like any trial (status TRIALING,
// trial_ends_at, no Stripe ids), so access checks and the daily expiry in
// /api/cron/reminders treat it as one. trial_source marks it so it can be
// revoked, replaced, and capped at the granted plan rather than Premium.

export const EXTENDED_TRIAL_SOURCE = "ADMIN_EXTENDED"
export const EXTENDED_TRIAL_TIERS = ["PREMIUM", "PREMIUM_PLUS"] as const
export type ExtendedTrialTier = (typeof EXTENDED_TRIAL_TIERS)[number]
export const EXTENDED_TRIAL_PRESETS = [14, 30, 60, 90] as const
export const EXTENDED_TRIAL_MAX_DAYS = 365
export const EXTENDED_TRIAL_NOTE_MAX = 200

const DAY_MS = 24 * 60 * 60 * 1000

let ensured: Promise<void> | null = null
/** subscriptions.trial_source: 'ADMIN_EXTENDED' for an admin-granted trial, else null. */
export function ensureTrialSourceColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_source TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

export interface ExtendedTrialInput {
  familyId: string
  tier: ExtendedTrialTier
  days: number
  note: string | null
  replace: boolean
}

export function parseExtendedTrialInput(body: unknown): { ok: true; input: ExtendedTrialInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const familyId = typeof b.familyId === "string" ? b.familyId.trim() : ""
  if (!familyId) return { ok: false, error: "familyId is required" }
  if (!EXTENDED_TRIAL_TIERS.includes(b.tier as ExtendedTrialTier)) {
    return { ok: false, error: "Tier must be Plus (PREMIUM) or Premium (PREMIUM_PLUS)" }
  }
  const days = typeof b.days === "string" && b.days.trim() !== "" ? Number(b.days) : b.days
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > EXTENDED_TRIAL_MAX_DAYS) {
    return { ok: false, error: `Days must be a whole number from 1 to ${EXTENDED_TRIAL_MAX_DAYS}` }
  }
  if (b.note != null && typeof b.note !== "string") return { ok: false, error: "Note must be text" }
  const note = typeof b.note === "string" ? b.note.trim() : ""
  if (note.length > EXTENDED_TRIAL_NOTE_MAX) return { ok: false, error: `Note must be ${EXTENDED_TRIAL_NOTE_MAX} characters or fewer` }
  return { ok: true, input: { familyId, tier: b.tier as ExtendedTrialTier, days, note: note || null, replace: b.replace === true } }
}

export function extendedTrialEnd(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * DAY_MS)
}

/** The family's subscription row, as far as these rules need it. */
export interface TrialRow {
  tier: string
  status: string
  trial_ends_at: string | Date | null
  stripe_subscription_id: string | null
  trial_source?: string | null
}

function activeTrialEnd(row: TrialRow, now: Date): Date | null {
  if (row.status !== "TRIALING" || !row.trial_ends_at) return null
  const end = new Date(row.trial_ends_at)
  return end.getTime() > now.getTime() ? end : null
}

/** An admin-granted trial that is still running and not tied to Stripe. */
export function isActiveExtendedTrial(row: TrialRow | null | undefined, now: Date = new Date()): boolean {
  return !!row && row.trial_source === EXTENDED_TRIAL_SOURCE && !row.stripe_subscription_id && !!activeTrialEnd(row, now)
}

export type GrantDecision =
  | { ok: true; kind: "grant" | "replace"; endsAt: Date }
  | { ok: false; status: 409; code: "PAYING" | "LONGER_TRIAL"; error: string }

/**
 * Whether a grant may go ahead. Never over a paying family: a live Stripe
 * subscription, or any other paid plan that is ACTIVE (e.g. set by Change
 * tier). A running trial that ends later than the new one is only replaced
 * when the admin asks to.
 */
export function decideGrant(row: TrialRow | null | undefined, input: Pick<ExtendedTrialInput, "days" | "replace">, now: Date = new Date()): GrantDecision {
  const endsAt = extendedTrialEnd(input.days, now)
  if (row && (trialBlockedByStripe(row) || (row.status === "ACTIVE" && row.tier !== "FREE"))) {
    return {
      ok: false,
      status: 409,
      code: "PAYING",
      error: `This family is on a paid ${getTierDefinition(row.tier).name} plan. An extended trial would overwrite it, so none was granted.`,
    }
  }
  const currentEnd = row ? activeTrialEnd(row, now) : null
  if (currentEnd && currentEnd.getTime() > endsAt.getTime() && !input.replace) {
    return {
      ok: false,
      status: 409,
      code: "LONGER_TRIAL",
      error: `This family already has a ${getTierDefinition(row!.tier).name} trial until ${currentEnd.toISOString().slice(0, 10)}, which is longer. Choose Replace to change it.`,
    }
  }
  return { ok: true, kind: row && isActiveExtendedTrial(row, now) ? "replace" : "grant", endsAt }
}

/**
 * Every trial (ordinary or extended) past its end with no Stripe subscription
 * drops to Free. Run daily by /api/cron/reminders. Returns how many ended.
 */
export async function endExpiredTrials(): Promise<number> {
  await ensureTrialSourceColumn()
  const rows = await sql`
    UPDATE subscriptions
    SET tier = 'FREE', status = 'ACTIVE', trial_source = NULL, updated_at = NOW()
    WHERE status = 'TRIALING'
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at < NOW()
      AND stripe_subscription_id IS NULL
    RETURNING id
  `
  return rows.length
}

/**
 * The plan whose caps apply to a family on a trial: the granted plan for an
 * extended trial, else null (ordinary trials get Premium's caps).
 */
export async function extendedTrialTier(familyId: string): Promise<SubscriptionTierKey | null> {
  try {
    await ensureTrialSourceColumn()
    const rows = await sql`
      SELECT tier, status, trial_ends_at, stripe_subscription_id, trial_source
      FROM subscriptions
      WHERE family_id = ${familyId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0] as TrialRow | undefined
    return isActiveExtendedTrial(row) ? getTierDefinition(row!.tier).key : null
  } catch (error) {
    console.error("[extended-trial] lookup failed:", error)
    return null
  }
}
