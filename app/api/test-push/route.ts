import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getAdminFromToken } from '@/lib/admin-auth'
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

    // Check for registered push subscriptions
    const subscriptions = await sql`
      SELECT pt.*, u.email, u.first_name
      FROM push_tokens pt
      JOIN users u ON pt.user_id = u.id
      WHERE pt.is_active = true
      LIMIT 5
    `

    const webPushStatus = isVapidConfigured()
      ? '✓ VAPID keys configured'
      : '✗ Missing VAPID_PRIVATE_KEY and/or NEXT_PUBLIC_VAPID_PUBLIC_KEY'

    return NextResponse.json({
      success: true,
      config: configStatus,
      webPushStatus,
      registeredDevices: subscriptions.length,
      devices: subscriptions.map(s => ({
        userId: s.user_id,
        email: s.email,
        name: s.first_name,
        platform: s.platform || 'web',
        createdAt: s.created_at
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

    // Parse request body for specific emails
    let targetEmails: string[] = []
    try {
      const body = await request.json()
      if (body.emails && Array.isArray(body.emails)) {
        targetEmails = body.emails
      }
    } catch {
      // No body or invalid JSON - send to all
    }

    // Get active push subscriptions, optionally filtered by email
    const subscriptions = targetEmails.length > 0
      ? await sql`
          SELECT pt.*, u.email, u.first_name
          FROM push_tokens pt
          JOIN users u ON pt.user_id = u.id
          WHERE pt.is_active = true
          AND u.email = ANY(${targetEmails}::text[])
        `
      : await sql`
          SELECT pt.*, u.email, u.first_name
          FROM push_tokens pt
          JOIN users u ON pt.user_id = u.id
          WHERE pt.is_active = true
        `

    if (subscriptions.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No registered devices found. Please enable push notifications in Settings > Notifications first.'
      })
    }

    const results = []

    for (const sub of subscriptions) {
      try {
        const subscription = JSON.parse(sub.token)
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
          results.push({ email: sub.email, status: 'failed', error: 'Stored token is not a valid push subscription' })
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
          results.push({ email: sub.email, status: 'sent' })
        } else {
          results.push({ email: sub.email, status: 'failed', error: result.error })
          if (result.gone) {
            await sql`UPDATE push_tokens SET is_active = false WHERE token = ${sub.token}`
          }
        }
      } catch (error) {
        results.push({
          email: sub.email,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

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
