import { sql } from "./db"
import { checkFamilySubscription } from "./auth"
import { extendedTrialTier } from "./extended-trial"
import { getTierDefinition, type SubscriptionTierKey } from "./subscription-tiers"
import { ensurePlanUsageTable, usagePeriod } from "./tier-limits"
import { smartImportCap, smartImportUpgrade } from "./smart-import"

// Smart Import's monthly count per family, in plan_usage (kind 'smartImport').
// A slot is taken before the model call and given back if the call fails.

const KIND = "smartImport"

export interface SmartImportUsage {
  used: number
  limit: number
  upgradeTo: { key: SubscriptionTierKey; name: string; limit: number } | null
}

async function planFor(familyId: string): Promise<{ tier: SubscriptionTierKey; userTrial: boolean }> {
  const sub = await checkFamilySubscription(familyId)
  if (sub.trial === true) {
    const extended = await extendedTrialTier(familyId)
    return extended ? { tier: extended, userTrial: false } : { tier: "PREMIUM_PLUS", userTrial: true }
  }
  return { tier: getTierDefinition(sub.tier).key, userTrial: false }
}

async function countNow(familyId: string): Promise<number> {
  await ensurePlanUsageTable()
  const rows = await sql`
    SELECT count FROM plan_usage WHERE family_id = ${familyId} AND kind = ${KIND} AND period = ${usagePeriod()}
  `
  return Number(rows[0]?.count ?? 0)
}

export async function smartImportUsage(familyId: string): Promise<SmartImportUsage> {
  const { tier, userTrial } = await planFor(familyId)
  return { used: await countNow(familyId), limit: smartImportCap(tier, userTrial), upgradeTo: smartImportUpgrade(tier, userTrial) }
}

/** Takes one import atomically, so two requests at once can't both take the last one. */
export async function claimSmartImport(familyId: string): Promise<SmartImportUsage & { allowed: boolean }> {
  const { tier, userTrial } = await planFor(familyId)
  const limit = smartImportCap(tier, userTrial)
  const upgradeTo = smartImportUpgrade(tier, userTrial)
  await ensurePlanUsageTable()
  const rows = await sql`
    INSERT INTO plan_usage (family_id, kind, period, count)
    SELECT ${familyId}, ${KIND}, ${usagePeriod()}, 1 WHERE ${limit}::int > 0
    ON CONFLICT (family_id, kind, period) DO UPDATE SET count = plan_usage.count + 1
      WHERE plan_usage.count < ${limit}::int
    RETURNING count
  `
  if (rows.length > 0) return { allowed: true, used: Number(rows[0].count), limit, upgradeTo }
  return { allowed: false, used: await countNow(familyId), limit, upgradeTo }
}

/** Gives back the import taken by claimSmartImport when the model call failed. */
export async function releaseSmartImport(familyId: string): Promise<void> {
  await sql`
    UPDATE plan_usage SET count = GREATEST(count - 1, 0)
    WHERE family_id = ${familyId} AND kind = ${KIND} AND period = ${usagePeriod()}
  `
}
