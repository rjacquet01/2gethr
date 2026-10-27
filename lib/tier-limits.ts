import { NextResponse } from "next/server"
import { sql } from "./db"
import { ddl } from "./schema-snapshot"
import { checkFamilySubscription } from "./auth"
import { getTierDefinition, type SubscriptionTierKey } from "./subscription-tiers"
import { capFor, evaluateLimit, planLimitBody, type PlanLimitKind, type PlanLimitResult } from "./plan-limits"

// Server-side plan caps (numbers: lib/subscription-tiers.ts; rules and
// wording: lib/plan-limits.ts). A family over a cap keeps everything it has;
// it just can't add more until it is back under the cap or upgrades. Trials
// get Premium's caps until the trial ends. Safety features are never capped:
// arrival/departure alerts, SOS, emergency alerts, approval requests and
// account email don't go through here, and only pushes marked routine count
// toward the push quota.

export * from "./plan-limits"

/** The family's tier for plan caps: its plan, or Premium while on a trial. */
export async function limitTier(familyId: string): Promise<{ tier: SubscriptionTierKey; trial: boolean }> {
  const sub = await checkFamilySubscription(familyId)
  const trial = sub.trial === true
  const tier = trial ? "PREMIUM_PLUS" : getTierDefinition(sub.tier).key
  return { tier, trial }
}

/** 'YYYY-MM' in UTC, the same month the text quota uses. */
export function usagePeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

let usageEnsured: Promise<void> | null = null
function ensurePlanUsageTable(): Promise<void> {
  if (!usageEnsured) {
    usageEnsured = (async () => {
      await ddl`
        CREATE TABLE IF NOT EXISTS plan_usage (
          family_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          period TEXT NOT NULL,
          count INT NOT NULL DEFAULT 0,
          PRIMARY KEY (family_id, kind, period)
        )
      `
    })().catch((err) => {
      usageEnsured = null
      throw err
    })
  }
  return usageEnsured
}

async function monthlyCount(familyId: string, kind: PlanLimitKind): Promise<number> {
  await ensurePlanUsageTable()
  const rows = await sql`
    SELECT count FROM plan_usage WHERE family_id = ${familyId} AND kind = ${kind} AND period = ${usagePeriod()}
  `
  return Number(rows[0]?.count ?? 0)
}

/** How many of `kind` the family has now. `exceptMemberId`: leave this member out (location sharers). */
export async function countUsage(familyId: string, kind: PlanLimitKind, opts: { exceptMemberId?: string } = {}): Promise<number> {
  switch (kind) {
    case "eventsPerMonth":
    case "routinePush":
      return monthlyCount(familyId, kind)
    case "activeReminders": {
      // Upcoming and not yet fired; a declined request doesn't count.
      const rows = await sql`
        SELECT COUNT(*)::int AS n FROM reminders
        WHERE family_id = ${familyId} AND status = 'PENDING' AND sent_at IS NULL
          AND COALESCE(approval_status, '') <> 'DECLINED'
      `
      return Number(rows[0]?.n ?? 0)
    }
    case "boardUploads": {
      // Photo uploads still stored, including taken-down ones that can be restored.
      const rows = await sql`
        SELECT COUNT(*)::int AS n FROM family_posts
        WHERE family_id = ${familyId} AND deleted_at IS NULL AND flyer_full_path IS NOT NULL
      `
      return Number(rows[0]?.n ?? 0)
    }
    case "locationSharers": {
      const rows = await sql`
        SELECT COUNT(*)::int AS n FROM location_settings ls
        JOIN family_members fm ON fm.id = ls.family_member_id
        WHERE fm.family_id = ${familyId} AND fm.is_active = true AND fm.role <> 'GUEST'
          AND ls.mode = 'ACTIVE' AND ls.share_with_family = true
          AND fm.id <> ${opts.exceptMemberId ?? ""}
      `
      return Number(rows[0]?.n ?? 0)
    }
  }
}

/** Can this family add one more of `kind`? */
export async function checkLimit(
  familyId: string,
  kind: PlanLimitKind,
  opts: { exceptMemberId?: string } = {}
): Promise<PlanLimitResult> {
  const { tier, trial } = await limitTier(familyId)
  if (capFor(tier, kind) === null) return evaluateLimit(kind, tier, trial, 0)
  return evaluateLimit(kind, tier, trial, await countUsage(familyId, kind, opts))
}

/**
 * Takes one slot of a monthly cap (events created, routine pushes) atomically,
 * so two requests at once can't both take the last one. Unlimited plans are
 * still counted, so the numbers are right after a downgrade.
 */
export async function claimMonthly(familyId: string, kind: "eventsPerMonth" | "routinePush"): Promise<PlanLimitResult> {
  const { tier, trial } = await limitTier(familyId)
  await ensurePlanUsageTable()
  const period = usagePeriod()
  const limit = capFor(tier, kind)
  const rows = limit === null
    ? await sql`
        INSERT INTO plan_usage (family_id, kind, period, count) VALUES (${familyId}, ${kind}, ${period}, 1)
        ON CONFLICT (family_id, kind, period) DO UPDATE SET count = plan_usage.count + 1
        RETURNING count
      `
    : await sql`
        INSERT INTO plan_usage (family_id, kind, period, count)
        SELECT ${familyId}, ${kind}, ${period}, 1 WHERE ${limit}::int > 0
        ON CONFLICT (family_id, kind, period) DO UPDATE SET count = plan_usage.count + 1
          WHERE plan_usage.count < ${limit}::int
        RETURNING count
      `
  if (rows.length > 0) return { ...evaluateLimit(kind, tier, trial, Number(rows[0].count) - 1), allowed: true }
  return evaluateLimit(kind, tier, trial, await monthlyCount(familyId, kind))
}

/** Gives back a slot taken by claimMonthly when the thing wasn't created or sent after all. */
export async function releaseMonthly(familyId: string, kind: "eventsPerMonth" | "routinePush"): Promise<void> {
  await sql`
    UPDATE plan_usage SET count = GREATEST(count - 1, 0)
    WHERE family_id = ${familyId} AND kind = ${kind} AND period = ${usagePeriod()}
  `
}

/** 402 for a request over a plan cap; neutral wording when it came from the Android app. */
export function planLimitResponse(r: PlanLimitResult, request?: { cookies: { get(name: string): { value: string } | undefined } }): NextResponse {
  const inApp = request?.cookies.get("togethr_android")?.value === "1"
  return NextResponse.json(planLimitBody(r, { inApp }), { status: 402 })
}
