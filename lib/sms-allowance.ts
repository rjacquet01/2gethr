import { getTierDefinition } from "@/lib/subscription-tiers"

export interface SmsUsage {
  used: number
  quota: number
  trial: boolean
  /** "2026-10": the UTC month the count is for (lib/services/sms.ts currentPeriod). */
  period?: string
}

export interface SmsAllowanceNotice {
  title: string
  body: string
  /** A bigger allowance is available on another plan (or after the trial). */
  canUpgrade: boolean
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "November 1": when the count starts over (the month after `period`, else after now, in UTC). */
export function smsResetLabel(period?: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period ?? "")
  const month = m ? Number(m[2]) - 1 : now.getUTCMonth()
  return `${MONTHS[(month + 1) % 12]} 1`
}

/** The notice Settings shows once the family's texts for the month are used up; null before then. */
export function smsAllowanceNotice(usage: SmsUsage | null | undefined, now: Date = new Date()): SmsAllowanceNotice | null {
  if (!usage || usage.quota <= 0 || usage.used < usage.quota) return null
  const topQuota = getTierDefinition("PREMIUM_PLUS").limits.smsMonthlyQuota
  return {
    title: `All ${usage.quota} texts used this month`,
    body: `Your family has used ${usage.trial ? "its trial's" : "this month's"} ${usage.quota} text messages, so texts are paused until ${smsResetLabel(usage.period, now)}. Push and email notifications still arrive, and emergency alerts still go out by text.`,
    canUpgrade: usage.trial || usage.quota < topQuota,
  }
}
