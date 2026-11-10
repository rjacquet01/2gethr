import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, hasPermission, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'

// GET - List all notifications (admin view)
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = request.nextUrl.searchParams.get('userId')
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '100') || 100, 1), 500)
    const offset = Math.max(parseInt(request.nextUrl.searchParams.get('offset') || '0') || 0, 0)

    let notifications
    if (userId) {
      notifications = await sql`
        SELECT n.*, u.email, u.first_name, u.last_name
        FROM notifications n
        LEFT JOIN users u ON n.user_id = u.id
        WHERE n.user_id = ${userId}
        ORDER BY n.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    } else {
      notifications = await sql`
        SELECT n.*, u.email, u.first_name, u.last_name
        FROM notifications n
        LEFT JOIN users u ON n.user_id = u.id
        ORDER BY n.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    }

    return NextResponse.json({
      success: true,
      data: notifications,
    })
  } catch (error) {
    console.error('Admin notifications GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

// POST - Send notification to user(s)
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!hasPermission(admin, 'manage_users')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { userIds, type = 'SYSTEM_ALERT', title, message, data = {} } = body

    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 })
    }

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'At least one user ID is required' }, { status: 400 })
    }

    // One send reaches at most 500 people, and only real ids.
    if (userIds.length > 500 || userIds.some((u: unknown) => typeof u !== 'string' || !u)) {
      return NextResponse.json({ error: 'Send to at most 500 valid user IDs at a time' }, { status: 400 })
    }

    // Valid notification types from enum
    const validTypes = ['EVENT_REMINDER', 'LOCATION_ALERT', 'FAMILY_INVITE', 'SYSTEM_ALERT', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'APPROVAL_REQUEST', 'APPROVAL_RESPONSE']
    const notificationType = validTypes.includes(type) ? type : 'SYSTEM_ALERT'

    // Create notifications for each user
    const notifications = []
    for (const userId of userIds) {
      const notif = await sql`
        INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at)
        VALUES (
          ${'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)},
          ${userId},
          ${notificationType},
          ${title},
          ${message},
          ${JSON.stringify({ ...data, sentByAdmin: admin.id })}::jsonb,
          false,
          NOW()
        )
        RETURNING *
      `
      notifications.push(notif[0])
    }

    // Log admin action
    await logAdminAction(admin.id, 'send_notification', 'notification', notifications[0]?.id, {
      recipientCount: userIds.length,
      type,
      title,
    })

    return NextResponse.json({
      success: true,
      data: { sent: notifications.length },
    })
  } catch (error) {
    console.error('Admin notifications POST error:', error)
    return NextResponse.json({ error: 'Failed to send notifications' }, { status: 500 })
  }
}
