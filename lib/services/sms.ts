/**
 * SMS Service using Twilio
 * 
 * Required environment variables:
 * - TWILIO_ACCOUNT_SID: Your Twilio Account SID
 * - TWILIO_AUTH_TOKEN: Your Twilio Auth Token  
 * - TWILIO_PHONE_NUMBER: Your Twilio phone number (e.g., +1234567890)
 */

import { sql } from '@/lib/db'
import { getTierDefinition, TRIAL_SMS_QUOTA } from '@/lib/subscription-tiers'

interface SMSPayload {
  to: string
  body: string
}

interface SMSResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Check if Twilio is configured
 */
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  )
}

/**
 * Send SMS via Twilio
 */
export async function sendSMS({ to, body }: SMSPayload): Promise<SMSResult> {
  if (!isTwilioConfigured()) {
    console.warn('Twilio not configured - SMS not sent')
    return { success: false, error: 'Twilio not configured' }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const fromNumber = process.env.TWILIO_PHONE_NUMBER!

  try {
    // Format phone number (ensure it starts with +)
    // Normalize to E.164. Numbers are stored in several shapes ("6176789621",
    // "16176789621", "(617) 678-9621", "+16176789621"); blindly prefixing +1
    // turned an 11-digit "1617..." into an invalid "+1617..." with an extra 1.
    const digits = to.replace(/\D/g, '')
    const formattedTo = to.trim().startsWith('+')
      ? `+${digits}`
      : digits.length === 11 && digits.startsWith('1')
        ? `+${digits}`
        : `+1${digits}`

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: formattedTo,
          From: fromNumber,
          Body: body,
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Twilio error:', data)
      return { 
        success: false, 
        error: data.message || 'Failed to send SMS' 
      }
    }

    return { 
      success: true, 
      messageId: data.sid 
    }
  } catch (error) {
    console.error('SMS send error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

// ---------------------------------------------------------------------------
// Monthly SMS quotas per family (texts cost money; push and email are free).
// Free 0, Plus 25, Premium 100, active free trial 10 - from
// lib/subscription-tiers.ts. Urgent safety alerts (SOS, emergency, urgent
// family alerts) are never blocked, but they still count toward the month.
// ---------------------------------------------------------------------------

let smsUsageEnsured: Promise<void> | null = null
function ensureSmsUsageTable(): Promise<void> {
  if (!smsUsageEnsured) {
    smsUsageEnsured = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS sms_usage (
          family_id TEXT NOT NULL,
          period TEXT NOT NULL,
          count INT NOT NULL DEFAULT 0,
          PRIMARY KEY (family_id, period)
        )
      `
    })().catch((err) => {
      smsUsageEnsured = null
      throw err
    })
  }
  return smsUsageEnsured
}

/** The quota month, 'YYYY-MM' in UTC. */
function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** This family's monthly text allowance from its plan (trial: TRIAL_SMS_QUOTA). */
export async function smsQuotaForFamily(familyId: string): Promise<{ quota: number; trial: boolean }> {
  const rows = await sql`
    SELECT tier, status, trial_ends_at FROM subscriptions
    WHERE family_id = ${familyId} AND status IN ('ACTIVE', 'TRIALING')
    ORDER BY created_at DESC LIMIT 1
  `
  const s = rows[0]
  if (s && s.status === 'TRIALING' && (!s.trial_ends_at || new Date(s.trial_ends_at).getTime() > Date.now())) {
    return { quota: TRIAL_SMS_QUOTA, trial: true }
  }
  // A trial that has ended (the daily cleanup hasn't flipped the row yet)
  // gets the Free allowance, not the paid plan's.
  const trialEnded = s?.status === 'TRIALING'
  return { quota: getTierDefinition(trialEnded ? 'FREE' : s?.tier ?? 'FREE').limits.smsMonthlyQuota, trial: false }
}

/** Texts used and allowed this month, for Settings > Notifications. */
export async function getSmsUsage(familyId: string): Promise<{ used: number; quota: number; period: string; trial: boolean }> {
  await ensureSmsUsageTable()
  const period = currentPeriod()
  const [{ quota, trial }, rows] = await Promise.all([
    smsQuotaForFamily(familyId),
    sql`SELECT count FROM sms_usage WHERE family_id = ${familyId} AND period = ${period}`,
  ])
  return { used: Number(rows[0]?.count ?? 0), quota, period, trial }
}

/** A user's family to bill a text to when the caller doesn't know it (owned family first). */
async function familyForUser(userId: string): Promise<string | null> {
  const rows = await sql`
    SELECT fm.family_id FROM family_members fm JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = ${userId} AND fm.is_active = true
    ORDER BY (f.owner_id = ${userId}) DESC, fm.joined_at ASC
    LIMIT 1
  `
  return (rows[0]?.family_id as string) ?? null
}

// Log "over quota" once per family per month per server instance.
const overQuotaLogged = new Set<string>()

export interface MeteredSMSPayload extends SMSPayload {
  /** Family whose monthly quota the text counts against. */
  familyId?: string | null
  /** Used to find the family when familyId isn't known. */
  userId?: string | null
  /** SOS / emergency / urgent safety alert: always sent, still counted. */
  urgent?: boolean
}

export interface MeteredSMSResult extends SMSResult {
  /** Set when the text was deliberately not sent. */
  skipped?: 'quota' | 'no-family'
}

/**
 * Send a text if the family still has quota this month, counting it
 * atomically. Over quota: nothing is sent, it's logged once, and the caller
 * carries on (push/email still go out). Urgent alerts always send. Never throws.
 */
export async function sendSMSMetered(payload: MeteredSMSPayload): Promise<MeteredSMSResult> {
  const { to, body, urgent = false } = payload
  if (!isTwilioConfigured()) return sendSMS({ to, body })
  try {
    const familyId = payload.familyId || (payload.userId ? await familyForUser(payload.userId) : null)
    if (!familyId) {
      // Nothing to count against: an urgent alert still goes out.
      if (urgent) return sendSMS({ to, body })
      console.warn('[SMS] No family to count this text against - not sent')
      return { success: false, skipped: 'no-family', error: 'No family for SMS quota' }
    }

    await ensureSmsUsageTable()
    const period = currentPeriod()
    let claimed = false
    if (urgent) {
      await sql`
        INSERT INTO sms_usage (family_id, period, count) VALUES (${familyId}, ${period}, 1)
        ON CONFLICT (family_id, period) DO UPDATE SET count = sms_usage.count + 1
      `
      claimed = true
    } else {
      const { quota } = await smsQuotaForFamily(familyId)
      if (quota > 0) {
        // Only one increment can win the last slot.
        const rows = await sql`
          INSERT INTO sms_usage (family_id, period, count) VALUES (${familyId}, ${period}, 1)
          ON CONFLICT (family_id, period) DO UPDATE SET count = sms_usage.count + 1
            WHERE sms_usage.count < ${quota}
          RETURNING count
        `
        claimed = rows.length > 0
      }
    }

    if (!claimed) {
      const key = `${familyId}:${period}`
      if (!overQuotaLogged.has(key)) {
        overQuotaLogged.add(key)
        console.warn(`[SMS] Family ${familyId} is over its monthly SMS quota for ${period}; texts skipped (push/email still sent)`)
      }
      return { success: false, skipped: 'quota', error: 'Monthly SMS quota reached' }
    }

    const result = await sendSMS({ to, body })
    if (!result.success) {
      // A text that didn't go out doesn't use up the quota.
      await sql`
        UPDATE sms_usage SET count = GREATEST(count - 1, 0)
        WHERE family_id = ${familyId} AND period = ${period}
      `.catch(() => {})
    }
    return result
  } catch (error) {
    console.error('[SMS] Metered send failed:', error)
    // Metering broke (e.g. database hiccup): an urgent alert still goes out.
    if (urgent) return sendSMS({ to, body })
    return { success: false, error: error instanceof Error ? error.message : 'SMS metering failed' }
  }
}

/**
 * Send SMS to multiple recipients (each text counts against the family's quota)
 */
export async function sendBulkSMS(
  recipients: string[],
  body: string,
  familyId: string
): Promise<{ sent: number; failed: number; results: SMSResult[] }> {
  const results: SMSResult[] = []
  let sent = 0
  let failed = 0

  for (const to of recipients) {
    const result = await sendSMSMetered({ to, body, familyId })
    results.push(result)
    if (result.success) {
      sent++
    } else {
      failed++
    }
  }

  return { sent, failed, results }
}

// SMS Templates for Togethr
export const SMS_TEMPLATES = {
  GEOFENCE_ARRIVAL: (childName: string, placeName: string) =>
    `Togethr Alert: ${childName} has arrived at ${placeName}.`,

  GEOFENCE_DEPARTURE: (childName: string, placeName: string) =>
    `Togethr Alert: ${childName} has left ${placeName}.`,

  EVENT_REMINDER: (eventTitle: string, time: string) =>
    `Togethr Reminder: "${eventTitle}" starts at ${time}.`,

  TASK_OVERDUE: (taskTitle: string, childName: string) =>
    `Togethr Alert: Task "${taskTitle}" assigned to ${childName} is overdue.`,

  EMERGENCY_ALERT: (childName: string, message: string) =>
    `Togethr EMERGENCY: ${childName} - ${message}`,

  LOCATION_CHECK_IN: (childName: string, location: string) =>
    `Togethr: ${childName} checked in at ${location}.`,

  VERIFICATION_CODE: (code: string) =>
    `Your Togethr verification code is: ${code}. Valid for 10 minutes.`,
}
