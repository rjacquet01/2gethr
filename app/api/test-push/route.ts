import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getAdminFromToken, logAdminAction } from '@/lib/admin-auth'
import { sendWebPush, isVapidConfigured } from '@/lib/services/web-push-vapid'

// SECURITY FIX: this file previously contained a live Firebase service-account
// private key hardcoded in source ("temporarily, due to env var caching
// issues"). That key must be treated as compromised — rotate/revoke it in the
// Firebase console (IAM & Admin > Service Accounts) immediately.
// This route also had no authentication at all: GET leaked every user's
// email/name/device list, and POST could push a notification to any or all
// users. Both now require a logged-in admin.
//
// CORRECTNESS FIX: this route used to send via Firebase Admin's
// messaging().send() API, passing the stored push_tokens row straight
// through as an FCM registration token. That token is actually a raw
// PushSubscription (endpoint + keys) from the browser's PushManager, not an
// FCM token, so every send failed with a 404 "NotRegistered" error even
// though the subscription itself was valid. It now delivers via the real
// Web Push protocol (VAPID + RFC 8291 encryption, see
// lib/services/web-push-vapid.ts) — the same thing lib/services/push.ts
// uses, and what the client and service worker were always built for.

// "android", "web · Chrome on Windows" etc. device_info is whatever the
// client sent when subscribing (a string or a small JSON object).
function deviceLabel(platform: string | null, info: unknown): string {
  let detail = ''
  if (typeof info === 'string') detail = info
  else if (info && typeof info === 'object') {
    const o = info as Record<string, unknown>
    detail = String(o.browser || o.userAgent || o.model || '')
  }
  detail = detail.slice(0, 60)
  return [platform || 'web', detail].filter(Boolean).join(' · ')
}

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const admin = token ? await getAdminFromToken(token) : null
  // Debug tool that can push to every user and lists their emails: super
  // admins only (support staff don't need it).
  return admin && admin.roles.includes('SUPER_ADMIN') ? admin : null
}

export async function GET(request: Request) {
  const requestingAdmin = await requireAdmin(request)
  if (!requestingAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    // Check Web Push (VAPID) config
    const configStatus = {
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? '✓ Set' : '✗ Missing',
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ? '✓ Set' : '✗ Missing',
    }

    // Every account with push turned on, one row each. Never the token
    // (subscription endpoint and keys).
    const accounts = await sql`
      SELECT u.id AS user_id, u.email, u.first_name, u.last_name,
             COUNT(*)::int AS device_count,
             array_agg(DISTINCT COALESCE(pt.platform, 'web')) AS platforms,
             MAX(COALESCE(pt.updated_at, pt.created_at)) AS last_registered_at
      FROM push_tokens pt
      JOIN users u ON pt.user_id = u.id
      WHERE pt.is_active = true
      GROUP BY u.id, u.email, u.first_name, u.last_name
      ORDER BY u.first_name, u.email
    `

    const webPushStatus = isVapidConfigured()
      ? '✓ VAPID keys configured'
      : '✗ Missing VAPID_PRIVATE_KEY and/or NEXT_PUBLIC_VAPID_PUBLIC_KEY'

    return NextResponse.json({
      success: true,
      config: configStatus,
      webPushStatus,
      totalAccounts: accounts.length,
      registeredDevices: accounts.reduce((n, a) => n + Number(a.device_count), 0),
      accounts: accounts.map(a => ({
        userId: a.user_id,
        email: a.email,
        name: `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email,
        deviceCount: Number(a.device_count),
        platforms: a.platforms,
        lastRegisteredAt: a.last_registered_at,
      }))
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const requestingAdmin = await requireAdmin(request)
  if (!requestingAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    if (!isVapidConfigured()) {
      return NextResponse.json({
        success: false,
        error: 'Web Push is not configured. Set VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY in the environment.'
      }, { status: 400 })
    }

    // { emails: [...] } for chosen accounts, or { all: true } for everyone.
    // Anything else (no body, empty list) is refused rather than treated as
    // "everyone", so a bad request can't notify every user.
    const body = await request.json().catch(() => null)
    const targetEmails: string[] = Array.isArray(body?.emails)
      ? body.emails.filter((e: unknown): e is string => typeof e === 'string' && e.trim() !== '')
      : []
    const sendToAll = body?.all === true && targetEmails.length === 0
    if (!sendToAll && targetEmails.length === 0) {
      return NextResponse.json({ success: false, error: 'Choose an account, or send { all: true } to notify every device.' }, { status: 400 })
    }

    const subscriptions = sendToAll
      ? await sql`
          SELECT pt.*, u.email, u.first_name
          FROM push_tokens pt
          JOIN users u ON pt.user_id = u.id
          WHERE pt.is_active = true
        `
      : await sql`
          SELECT pt.*, u.email, u.first_name
          FROM push_tokens pt
          JOIN users u ON pt.user_id = u.id
          WHERE pt.is_active = true
          AND u.email = ANY(${targetEmails}::text[])
        `

    if (subscriptions.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No registered devices found. Please enable push notifications in Settings > Notifications first.'
      })
    }

    const results: { email: string; device: string; registeredAt: string | null; status: 'sent' | 'failed'; error?: string }[] = []

    for (const sub of subscriptions) {
      // Which device this was, for the per-device result (never the token).
      const at = (r: Omit<(typeof results)[number], 'email' | 'device' | 'registeredAt'>) =>
        results.push({
          email: sub.email, device: deviceLabel(sub.platform, sub.device_info), registeredAt: sub.created_at ?? null, ...r,
          // A push service's error text can echo the endpoint URL.
          ...(r.error ? { error: r.error.replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 300) } : {}),
        })
      try {
        const subscription = JSON.parse(sub.token)
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
          at({ status: 'failed', error: 'Stored token is not a valid push subscription' })
          continue
        }

        const result = await sendWebPush(subscription, {
          title: 'Togethr Test Notification',
          body: `Hello ${sub.first_name || 'there'}! Push notifications are working correctly.`,
          icon: '/icons/togethr-icon-blue.png',
          badge: '/icons/togethr-icon-blue.png',
          type: 'TEST',
          timestamp: new Date().toISOString(),
        })

        if (result.success) {
          at({ status: 'sent' })
        } else {
          at({ status: 'failed', error: result.error })
          if (result.gone) {
            await sql`UPDATE push_tokens SET is_active = false WHERE token = ${sub.token}`
          }
        }
      } catch (error) {
        at({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }

    await logAdminAction(requestingAdmin.id, 'TEST_PUSH_SENT', 'push_test', null, {
      target: sendToAll ? 'all' : targetEmails,
      devices: results.length,
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
    }, request.headers.get('x-forwarded-for') || undefined)

    return NextResponse.json({
      success: true,
      totalDevices: subscriptions.length,
      results
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
