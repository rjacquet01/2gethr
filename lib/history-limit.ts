import { checkFamilySubscription } from "@/lib/auth"

// How many days of archived history a family's plan keeps visible
// (Free 30 / Basic 90 / Premium 365 - from lib/subscription-tiers.ts).
// Older archived items are hidden, not deleted, so upgrading restores them.
export async function getHistoryDays(familyId: string): Promise<number> {
  try {
    const sub = await checkFamilySubscription(familyId)
    return sub.features.historyDays || 30
  } catch {
    return 30
  }
}
