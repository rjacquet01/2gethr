import { checkFamilySubscription } from "@/lib/auth"
import { getTierDefinition } from "@/lib/subscription-tiers"

/** The one reminder time every plan gets. Choosing other times needs Basic or Premium. */
export const STANDARD_REMINDER_MINUTES = 15

interface RecurrenceLike {
  interval?: number | null
  daysOfWeek?: number[] | null
}

/**
 * Simple repeats (daily, weekly, monthly, yearly, weekdays) are for everyone.
 * "Advanced" = every N weeks/days/etc (interval > 1) or a custom set of
 * weekdays other than Mon-Fri.
 */
export function isAdvancedRecurrence(r: RecurrenceLike | null | undefined): boolean {
  if (!r) return false
  if ((r.interval ?? 1) > 1) return true
  const days = r.daysOfWeek || []
  if (days.length <= 1) return false
  const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
  return !isWeekdays
}

export function hasCustomReminderTimes(minutes: number[] | null | undefined): boolean {
  return (minutes || []).some((m) => m !== STANDARD_REMINDER_MINUTES)
}

/** Returns an upgrade message if the request uses a feature the family's plan lacks, else null. */
export async function planGateError(
  familyId: string,
  opts: { recurrence?: RecurrenceLike | null; reminderMinutes?: number[] | null }
): Promise<string | null> {
  const needsAdvanced = isAdvancedRecurrence(opts.recurrence)
  const needsCustom = hasCustomReminderTimes(opts.reminderMinutes)
  if (!needsAdvanced && !needsCustom) return null
  const sub = await checkFamilySubscription(familyId)
  const f = getTierDefinition(sub.tier).features
  if (needsAdvanced && !f.advancedRecurrence) {
    return "Custom repeat schedules (every 2 weeks, chosen days) are available on Basic and Premium plans. Upgrade to use them."
  }
  if (needsCustom && !f.customReminderTimes) {
    return "Custom reminder times are available on Basic and Premium plans. The Free plan uses the standard 15-minute reminder."
  }
  return null
}
