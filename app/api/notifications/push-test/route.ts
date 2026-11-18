import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { sql } from '@/lib/db'
import { sendPushToUser } from '@/lib/services/push'
import { isVapidConfigured } from '@/lib/services/web-push-vapid'
import { hitRateLimit, tooManyRequests } from '@/lib/rate-limit'

// "Send me a test notification" (Settings > Notifications): pushes one
// message to the signed-in account's own devices and says plainly what
// happened, so "I get no notifications" can be told apart from "push was
// never turned on here". Own devices only, and a few tries per 10 minutes.
export async function POST(request: Request) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isVapidConfigured()) {
    return NextResponse.json({ ok: false, reason: 'not-configured' }, { status: 503 })
  }

  const limit = await hitRateLimit(`push-test:${user.id}`, 5, 600)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec, 'test notifications')

  try {
    const rows = await sql`
      SELECT count(*)::int AS n FROM push_tokens WHERE user_id = ${user.id} AND is_active = true
    `
    if (!Number(rows[0]?.n)) {
      return NextResponse.json({ ok: false, reason: 'no-device' })
    }

    const { sent, failed } = await sendPushToUser(user.id, {
      title: 'Togethr test',
      body: 'Notifications are working on this device.',
      clickAction: '/settings',
      // A unique key so the service worker doesn't treat a second test as a copy.
      data: { type: 'TEST', dedupeKey: `test-${Date.now()}` },
      ttl: 120,
    })
    return NextResponse.json({ ok: sent > 0, sent, failed, reason: sent > 0 ? undefined : 'send-failed' })
  } catch (error) {
    console.error('Push test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
