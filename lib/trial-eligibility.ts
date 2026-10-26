import { sql } from "./db"
import { TRIAL_DAYS } from "./subscription-tiers"

// One free trial per year. Counted per owner (every family they own or once
// owned, so deleting a family and starting a new one doesn't reset it) and per
// family (so handing the family to another parent doesn't either).

/** Days from the start of one free trial until another may start. */
export const TRIAL_COOLDOWN_DAYS = 365

export interface TrialEligibility {
  eligible: boolean
  /** When the most recent trial started, or null if there never was one. */
  lastStartedAt: Date | null
  /** When the next trial may start, or null when one may start now. */
  nextAvailableAt: Date | null
}

export function trialEligibilityFrom(lastStartedAt: Date | null, now: Date = new Date()): TrialEligibility {
  if (!lastStartedAt) return { eligible: true, lastStartedAt: null, nextAvailableAt: null }
  const next = new Date(lastStartedAt.getTime() + TRIAL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
  return next.getTime() <= now.getTime()
    ? { eligible: true, lastStartedAt, nextAvailableAt: null }
    : { eligible: false, lastStartedAt, nextAvailableAt: next }
}

/**
 * Whether `userId` may start a free trial (for `familyId`, if given). Trial
 * starts come from the status history (sign-up, the Subscription page, admin
 * grants); a row with trial_ends_at but no history counts as starting
 * TRIAL_DAYS before it ended.
 */
export async function getTrialEligibility(userId: string, familyId?: string | null): Promise<TrialEligibility> {
  const fid = familyId ?? null
  const rows = await sql`
    SELECT GREATEST(
      (SELECT MAX(h.changed_at)
         FROM subscription_status_history h
         JOIN subscriptions s ON s.id = h.subscription_id
         JOIN families f ON f.id = s.family_id
        WHERE h.new_status = 'TRIALING'
          AND (f.owner_id = ${userId} OR s.family_id = ${fid})),
      (SELECT MAX(s.trial_ends_at - make_interval(days => ${TRIAL_DAYS}))
         FROM subscriptions s
         JOIN families f ON f.id = s.family_id
        WHERE s.trial_ends_at IS NOT NULL
          AND (f.owner_id = ${userId} OR s.family_id = ${fid}))
    ) AS last_started_at
  `
  const raw = rows[0]?.last_started_at
  return trialEligibilityFrom(raw ? new Date(raw) : null)
}

/** "October 24, 2027", for "you can start another free trial on ...". */
export function formatTrialDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
}
