import { checkFamilySubscription } from "@/lib/auth"
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-tiers"

const FREE_HISTORY_DAYS = SUBSCRIPTION_TIERS.FREE.limits.historyDays

// How many days of archived history a family's plan keeps visible
// (Free 7 / Plus 90 / Premium 90 - from lib/subscription-tiers.ts).
// Items older than the plan's window but inside the 90-day cap are hidden,
// not deleted, so upgrading Free -> Plus/Premium restores them. Nothing is
// kept beyond the cap: the archive cron deletes it (lib/retention.ts).
export async function getHistoryDays(familyId: string): Promise<number> {
  try {
    const sub = await checkFamilySubscription(familyId)
    return sub.features.historyDays || FREE_HISTORY_DAYS
  } catch {
    return FREE_HISTORY_DAYS
  }
}
