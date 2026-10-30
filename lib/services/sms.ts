/**
 * SMS Service: Twilio (default) or Telnyx, chosen by SMS_PROVIDER.
 *
 * - SMS_PROVIDER: "twilio" (default) or "telnyx"; anything else means twilio
 * - Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 * - Telnyx: TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID (optional)
 *
 * Consent, quotas, metering and the "Togethr:" prefix are the same for both.
 * API keys never go into logs or error messages.
 */

import { sql } from '@/lib/db'
import { ddl } from '../schema-snapshot'
import { getTierDefinition, TRIAL_SMS_QUOTA } from '@/lib/subscription-tiers'
import { formatSmsBody, hasSmsConsent, optOutNumber, toE164 } from '@/lib/sms-consent'

interface SMSPayload {
  to: string
  body: string
  /** A safety alert (SOS, emergency): never cut to one segment. */
  keepWhole?: boolean
}

interface SMSResult {
  success: boolean
  messageId?: string
  error?: string
  /** Set when the text was deliberately not sent. */
  skipped?: 'quota' | 'no-family' | 'consent'
}

// The SOS / emergency retry loops treat this as permanent ("opted").
const NO_CONSENT: SMSResult = { success: false, skipped: 'consent', error: 'Not opted in to texts' }

/**
 * The provider refused because this number replied STOP: Twilio 21610,
 * Telnyx 40300. Twilio answers STOP itself and doesn't always pass it on to
 * our webhook, so this is how the app learns of it: texts are turned off for
 * that number here too (as the webhook would), and the send counts as no consent.
 */
export const OPTED_OUT_ERROR_CODES = { twilio: '21610', telnyx: '40300' } as const

async function optedOutAtProvider(to: string, provider: string): Promise<SMSResult> {
  try {
    const n = await optOutNumber(to)
    console.log(`[SMS] ${provider}: number replied STOP earlier; texts turned off for ${n} account(s)`)
  } catch (error) {
    console.error('[SMS] Recording an earlier STOP failed:', error instanceof Error ? error.message : 'unknown')
  }
  return { success: false, skipped: 'consent', error: 'This number replied STOP' }
}

/** A provider's error message without any phone number in it, for logs. */
const withoutNumbers = (s: unknown) => String(s ?? '').replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')

/** Has the owner of this number agreed to texts? A failed check counts as no. */
async function consented(to: string): Promise<boolean> {
  try {
    return await hasSmsConsent(to)
  } catch (error) {
    console.error('[SMS] Consent check failed - not sent:', error)
    return false
  }
}

export type SmsProvider = 'twilio' | 'telnyx'

/** The provider texts go out through: SMS_PROVIDER, Twilio unless it says "telnyx". */
export function smsProvider(): SmsProvider {
  return (process.env.SMS_PROVIDER || '').trim().toLowerCase() === 'telnyx' ? 'telnyx' : 'twilio'
}

export const SMS_PROVIDER_NAMES: Record<SmsProvider, string> = { twilio: 'Twilio', telnyx: 'Telnyx' }

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

export function isTelnyxConfigured(): boolean {
  return !!(process.env.TELNYX_API_KEY && process.env.TELNYX_FROM_NUMBER)
}

/** Whether the active provider (smsProvider()) can send. */
export function isSmsConfigured(): boolean {
  return smsProvider() === 'telnyx' ? isTelnyxConfigured() : isTwilioConfigured()
}

/**
 * Send SMS through the active provider, only to a number whose owner agreed
 * to texts (lib/sms-consent.ts). The body starts with "Togethr:" and fits one
 * segment where possible.
 */
export async function sendSMS({ to, body, keepWhole }: SMSPayload): Promise<SMSResult> {
  if (!isSmsConfigured()) {
    const name = SMS_PROVIDER_NAMES[smsProvider()]
    console.warn(`${name} not configured - SMS not sent`)
    return { success: false, error: `${name} not configured` }
  }
  if (!(await consented(to))) return NO_CONSENT
  return deliver(to, formatSmsBody(body, { keepWhole }))
}

async function deliver(to: string, body: string): Promise<SMSResult> {
  const formattedTo = toE164(to)
  if (!formattedTo) return { success: false, error: 'Invalid phone number' }
  return smsProvider() === 'telnyx' ? deliverTelnyx(formattedTo, body) : deliverTwilio(formattedTo, body)
}

/**
 * A reply to a text someone sent us (HELP / START), through Telnyx. They
 * wrote first, so there is no consent check or quota, as with Twilio's
 * TwiML replies.
 */
export async function sendTelnyxReply(to: string, body: string): Promise<SMSResult> {
  if (!isTelnyxConfigured()) {
    console.warn('Telnyx not configured - reply not sent')
    return { success: false, error: 'Telnyx not configured' }
  }
  const formattedTo = toE164(to)
  if (!formattedTo) return { success: false, error: 'Invalid phone number' }
  return deliverTelnyx(formattedTo, formatSmsBody(body))
}

async function deliverTelnyx(to: string, text: string): Promise<SMSResult> {
  const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID
  try {
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from: process.env.TELNYX_FROM_NUMBER,
        to,
        text,
        ...(profileId ? { messaging_profile_id: profileId } : {}),
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      // Only Telnyx's error code and title: never the request or its headers.
      const err = data?.errors?.[0]
      if (String(err?.code ?? '') === OPTED_OUT_ERROR_CODES.telnyx) return optedOutAtProvider(to, 'Telnyx')
      console.error('Telnyx error:', response.status, err?.code ?? '', err?.title ?? '')
      return { success: false, error: err?.detail || err?.title || `Telnyx error ${response.status}` }
    }
    return { success: true, messageId: data?.data?.id }
  } catch (error) {
    console.error('SMS send error (Telnyx):', error instanceof Error ? error.message : 'unknown')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function deliverTwilio(formattedTo: string, body: string): Promise<SMSResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const fromNumber = process.env.TWILIO_PHONE_NUMBER!

  try {
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
      if (String(data?.code ?? '') === OPTED_OUT_ERROR_CODES.twilio) return optedOutAtProvider(formattedTo, 'Twilio')
      // Twilio's code and message only (messages can name the number).
      console.error('Twilio error:', response.status, data?.code ?? '', withoutNumbers(data?.message))
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
      await ddl`
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

export type MeteredSMSResult = SMSResult

/**
 * Send a text if its recipient agreed to texts and the family still has
 * quota this month, counting it atomically. Over quota: nothing is sent,
 * it's logged once, and the caller carries on (push/email still go out).
 * Urgent alerts skip the quota, never the consent. Never throws.
 */
export async function sendSMSMetered(payload: MeteredSMSPayload): Promise<MeteredSMSResult> {
  const { to, urgent = false } = payload
  const body = formatSmsBody(payload.body, { keepWhole: urgent })
  if (!isSmsConfigured()) return sendSMS({ to, body })
  if (!(await consented(to))) return NO_CONSENT
  try {
    const familyId = payload.familyId || (payload.userId ? await familyForUser(payload.userId) : null)
    if (!familyId) {
      // Nothing to count against: an urgent alert still goes out.
      if (urgent) return deliver(to, body)
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

    const result = await deliver(to, body)
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
    if (urgent) return deliver(to, body)
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

// SMS Templates for Togethr (every text starts with "Togethr:")
export const SMS_TEMPLATES = {
  GEOFENCE_ARRIVAL: (childName: string, placeName: string) =>
    `Togethr: ${childName} arrived at ${placeName}.`,

  GEOFENCE_DEPARTURE: (childName: string, placeName: string) =>
    `Togethr: ${childName} left ${placeName}.`,

  EVENT_REMINDER: (eventTitle: string, time: string) =>
    `Togethr: Reminder - "${eventTitle}" starts at ${time}.`,

  TASK_OVERDUE: (taskTitle: string, childName: string) =>
    `Togethr: Task "${taskTitle}" for ${childName} is overdue.`,

  EMERGENCY_ALERT: (childName: string, message: string) =>
    `Togethr: EMERGENCY - ${childName}: ${message}`,

  LOCATION_CHECK_IN: (childName: string, location: string) =>
    `Togethr: ${childName} checked in at ${location}.`,

  VERIFICATION_CODE: (code: string) =>
    `Togethr: Your verification code is ${code}. Valid for 10 minutes.`,
}
