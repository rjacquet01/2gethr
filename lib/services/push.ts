/**
 * Push Notification Service
 *
 * Delivers to browser push subscriptions using the standard Web Push
 * protocol (VAPID + RFC 8291 encryption), implemented in
 * lib/services/web-push-vapid.ts.
 *
 * Historical note: this used to send through Firebase Cloud Messaging's
 * HTTP v1 API, passing the stored subscription JSON straight through as an
 * FCM "registration token". That doesn't work — a PushManager subscription
 * (the { endpoint, keys: { p256dh, auth } } object every browser produces)
 * is not an FCM token, so FCM correctly rejected every send with a 404
 * "NotRegistered" error. The client (hooks/use-push-notifications.ts) and
 * the service worker (public/sw.js) were always built around the real Web
 * Push standard, so this file now speaks that instead of FCM.
 *
 * Required environment variables:
 * - NEXT_PUBLIC_VAPID_PUBLIC_KEY: VAPID public key (base64url, 65-byte
 *   uncompressed P-256 point) — also used client-side as the
 *   applicationServerKey passed to PushManager.subscribe().
 * - VAPID_PRIVATE_KEY: matching VAPID private key (base64url, 32-byte
 *   scalar). Must be generated together with the public key — see
 *   lib/services/web-push-vapid.ts#generateVAPIDKeys.
 * - VAPID_SUBJECT (optional): a mailto: or https: contact URL, defaults to
 *   a generic support address.
 */

import { createHash } from 'crypto'
import { sql } from '@/lib/db'
import { sendWebPush, isVapidConfigured, PUSH_TTL_DEFAULT, PUSH_TTL_URGENT, type WebPushSubscription } from './web-push-vapid'

interface PushPayload {
  title: string
  body: string
  data?: Record<string, string>
  icon?: string
  badge?: string
  clickAction?: string
  /** Emergency delivery: Urgency: high header + priority flag for the service worker. */
  urgent?: boolean
  /** Seconds the push service may queue it (default by type: see pushTtlForType). */
  ttl?: number
  /** Same topic = a queued copy is replaced, not stacked (lib/services/web-push-vapid.ts). */
  topic?: string
}

// SOS, emergencies and location/geofence alerts stay deliverable for an hour;
// everything else is stale after 15 minutes, so nothing from yesterday turns
// up when a closed browser comes back.
export function pushTtlForType(type: string | undefined | null, urgent = false): number {
  if (urgent) return PUSH_TTL_URGENT
  return /SOS|EMERGENCY|GEOFENCE|LOCATION/i.test(String(type ?? '')) ? PUSH_TTL_URGENT : PUSH_TTL_DEFAULT
}

/**
 * The same notification (recipient, type, text, data) always gets the same
 * short key: used as the push Topic and the service worker's tag, so copies
 * replace each other instead of stacking. URL-safe base64, 32 characters.
 */
export function notificationDedupeKey(parts: { userId: string; type: string; title: string; body: string; data?: unknown }): string {
  return createHash('sha256')
    .update(JSON.stringify([parts.userId, parts.type, parts.title, parts.body, parts.data ?? null]))
    .digest('base64url')
    .slice(0, 32)
}

/** The browser endpoint inside a stored subscription (the token is its JSON); the raw token otherwise. */
function endpointOf(token: string): string {
  try {
    const p = JSON.parse(token)
    if (p && typeof p.endpoint === 'string') return p.endpoint
  } catch {}
  return token
}

interface PushResult {
  success: boolean
  messageId?: string
  error?: string
  /** true when the push service says this subscription is permanently gone (404/410) */
  gone?: boolean
}

/**
 * Check if push notifications are configured (VAPID keys present).
 *
 * Kept as `isFirebaseConfigured` for backward compatibility with existing
 * call sites (lib/notifications.ts, lib/services/notification-dispatcher.ts,
 * the admin notification-status routes) — it no longer has anything to do
 * with Firebase, it just checks whether push delivery is possible at all.
 */
export function isFirebaseConfigured(): boolean {
  return isVapidConfigured()
}

/** Accurate alias for isFirebaseConfigured(); prefer this in new code. */
export const isPushConfigured = isFirebaseConfigured

/**
 * Send a push notification to a single stored token.
 *
 * `token` is the JSON-stringified PushSubscription that the browser handed
 * back from `registration.pushManager.subscribe()` (see
 * hooks/use-push-notifications.ts) — not a raw string token.
 */
export async function sendPushNotification(
  token: string,
  payload: PushPayload
): Promise<PushResult> {
  if (!isVapidConfigured()) {
    console.warn('VAPID not configured - Push not sent')
    return { success: false, error: 'VAPID not configured' }
  }

  let subscription: WebPushSubscription
  try {
    const parsed = JSON.parse(token)
    if (!parsed?.endpoint || !parsed?.keys?.p256dh || !parsed?.keys?.auth) {
      return { success: false, error: 'Stored token is not a valid push subscription' }
    }
    subscription = parsed
  } catch {
    return { success: false, error: 'Stored token is not valid JSON' }
  }

  // public/sw.js's `push` event handler reads these fields flat off the top
  // level of the decrypted payload (data.title, data.body, data.url,
  // data.type, ...), not nested under a `data` sub-object — so whatever the
  // caller passed in `payload.data` (e.g. { type, taskId, eventId }) gets
  // spread in alongside title/body/url rather than wrapped.
  const result = await sendWebPush(subscription, {
    ...(payload.data || {}),
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icons/togethr-icon-blue.png',
    badge: payload.badge || '/icons/togethr-icon-blue.png',
    url: payload.clickAction || '/',
    ...(payload.urgent ? { priority: 'high' } : {}),
  }, {
    urgent: payload.urgent,
    ttl: payload.ttl ?? pushTtlForType(payload.data?.type, payload.urgent),
    topic: payload.topic ?? payload.data?.dedupeKey,
  })

  if (!result.success) {
    console.error('Web push error:', result.error)
    return { success: false, error: result.error, gone: result.gone }
  }

  return { success: true, messageId: `webpush-${Date.now()}` }
}

/**
 * Send push notification to a user (fetches their tokens from DB)
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  // Get user's push tokens from database
  const rows = await sql`
    SELECT token, platform FROM push_tokens
    WHERE user_id = ${userId}
      AND is_active = true
    ORDER BY updated_at DESC NULLS LAST
  `

  // One send per browser: two rows for the same endpoint (an old and a
  // re-subscribed copy) would otherwise buzz the same device twice.
  const seen = new Set<string>()
  const tokens = rows.filter((r) => {
    const ep = endpointOf(r.token as string)
    if (seen.has(ep)) return false
    seen.add(ep)
    return true
  })

  if (tokens.length === 0) {
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const { token } of tokens) {
    const result = await sendPushNotification(token, payload)
    if (result.success) {
      sent++
    } else {
      failed++
      // Only deactivate on a permanent failure (404/410 - subscription is
      // gone for good). A transient error (network blip, 429, 5xx from the
      // push service) shouldn't retire a token that might work next time.
      if (result.gone) {
        await sql`
          UPDATE push_tokens SET is_active = false
          WHERE token = ${token}
        `
      }
    }
  }

  return { sent, failed }
}

/**
 * Send push notification to multiple users
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let totalSent = 0
  let totalFailed = 0

  for (const userId of userIds) {
    const { sent, failed } = await sendPushToUser(userId, payload)
    totalSent += sent
    totalFailed += failed
  }

  return { sent: totalSent, failed: totalFailed }
}

/**
 * Register a push token for a user
 */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: 'web' | 'ios' | 'android',
  deviceInfo: Record<string, string> = {}
): Promise<boolean> {
  try {
    // Upsert the token. One browser has one subscription whoever is signed
    // in, so it moves to the account that turned push on most recently.
    await sql`
      INSERT INTO push_tokens (user_id, token, platform, device_info, is_active, created_at, updated_at)
      VALUES (${userId}, ${token}, ${platform}, ${JSON.stringify(deviceInfo)}::jsonb, true, NOW(), NOW())
      ON CONFLICT (token)
      DO UPDATE SET
        user_id = ${userId},
        device_info = ${JSON.stringify(deviceInfo)}::jsonb,
        is_active = true,
        updated_at = NOW()
    `
    // One browser = one active token: a re-subscription (or the same
    // browser's older subscription) is retired, so this person's pushes go
    // to it once. "Same browser" is the same platform and browser label
    // (e.g. "Chrome on Windows"; the full user agent isn't stored).
    if (platform === 'web' && deviceInfo.browser) {
      await sql`
        UPDATE push_tokens SET is_active = false, updated_at = NOW()
        WHERE user_id = ${userId} AND platform = ${platform} AND is_active = true
          AND token <> ${token} AND device_info->>'browser' = ${deviceInfo.browser}
      `
    }
    return true
  } catch (error) {
    console.error('Failed to register push token:', error)
    return false
  }
}

/**
 * Unregister a push token
 */
/** This device's subscription is on and belongs to this account. */
export async function isPushTokenActiveFor(token: string, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM push_tokens WHERE token = ${token} AND user_id = ${userId} AND is_active = true LIMIT 1
  `
  return rows.length > 0
}

export async function unregisterPushToken(token: string, userId: string): Promise<boolean> {
  try {
    // Only the caller's own device: a token value alone mustn't switch off
    // someone else's notifications.
    await sql`
      UPDATE push_tokens SET is_active = false
      WHERE token = ${token} AND user_id = ${userId}
    `
    return true
  } catch (error) {
    console.error('Failed to unregister push token:', error)
    return false
  }
}
