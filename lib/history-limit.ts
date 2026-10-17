import { checkFamilySubscription } from "@/lib/auth"

// How many days of archived history a family's plan keeps visible
// (Free 30 / Plus 90 / Premium 90 - from lib/subscription-tiers.ts).
// Items older than the plan's window but inside the 90-day cap are hidden,
// not deleted, so upgrading Free -> Plus/Premium restores them. Nothing is
// kept beyond the cap: the archive cron deletes it (lib/retention.ts).
export async function getHistoryDays(familyId: string): Promise<number> {
  try {
    const sub = await checkFamilySubscription(familyId)
    return sub.features.historyDays || 30
  } catch {
    return 30
  }
}
