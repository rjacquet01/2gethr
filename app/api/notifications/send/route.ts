import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAccessToken } from '@/lib/auth'
import { neon } from '@neondatabase/serverless'
import { 
  dispatchNotification, 
  dispatchNotificationToFamily,
  dispatchNotificationToParents,
  type NotificationChannel 
} from '@/lib/services/notification-dispatcher'

const sql = neon(process.env.DATABASE_URL!)

export async function POST(request: Request) {
  try {
    // Authenticate user
    const authHeader = request.headers.get('Authorization')
    let accessToken: string | undefined

    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7)
    }

    if (!accessToken) {
      const cookieStore = await cookies()
      accessToken = cookieStore.get('access_token')?.value
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(accessToken)
    if (!payload?.userId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      type,
      title, 
      message, 
      recipientType, // 'user', 'family', 'parents'
      recipientId,   // userId or familyId
      channels,      // optional: ['in_app', 'push', 'email', 'sms']
      data
    } = body

    // Validate required fields
    if (!title || !message) {
      return NextResponse.json(
        { error: 'Title and message are required' },
        { status: 400 }
      )
    }

    // Verify user has permission to send to target
    if (recipientType === 'family' || recipientType === 'parents') {
      if (!recipientId) {
        return NextResponse.json(
          { error: 'Family ID is required' },
          { status: 400 }
        )
      }
      
      // Check user is a member of the family
      const membership = await sql`
        SELECT role FROM family_members
        WHERE user_id = ${payload.userId}
          AND family_id = ${recipientId}
          AND is_active = true
      `

      if (membership.length === 0) {
        return NextResponse.json(
          { error: 'You are not a member of this family' },
          { status: 403 }
        )
      }
    }

    // Only in-app and push may be chosen by callers; email/SMS are reserved for system code.
    const allowedChannels: NotificationChannel[] = ['in_app', 'push']
    const safeChannels = Array.isArray(channels)
      ? (channels as NotificationChannel[]).filter((c) => allowedChannels.includes(c))
      : undefined

    // A user may only notify someone they share an active family with (or themselves).
    if (recipientType === 'user' && recipientId && recipientId !== payload.userId) {
      const shared = await sql`
        SELECT 1 FROM family_members a
        JOIN family_members b ON b.family_id = a.family_id
        WHERE a.user_id = ${payload.userId} AND a.is_active = true
          AND b.user_id = ${recipientId} AND b.is_active = true
        LIMIT 1
      `
      if (shared.length === 0) {
        return NextResponse.json({ error: 'You can only notify members of your family' }, { status: 403 })
      }
    }

    const notificationPayload = {
      type: type || 'SYSTEM',
      title: String(title).slice(0, 120),
      body: String(message).slice(0, 500),
      channels: safeChannels,
      data,
    }

    let result

    switch (recipientType) {
      case 'user':
        if (!recipientId) {
          return NextResponse.json(
            { error: 'User ID is required' },
            { status: 400 }
          )
        }
        result = await dispatchNotification({
          ...notificationPayload,
          userId: recipientId,
        })
        break

      case 'family':
        result = await dispatchNotificationToFamily(
          recipientId,
          notificationPayload,
          payload.userId // exclude sender
        )
        break

      case 'parents':
        result = await dispatchNotificationToParents(
          recipientId,
          notificationPayload
        )
        break

      default:
        // Default: send to self
        result = await dispatchNotification({
          ...notificationPayload,
          userId: payload.userId,
        })
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Notification send error:', error)
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 }
    )
  }
}
