import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"

// Get user's notifications
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const unreadOnly = request.nextUrl.searchParams.get("unreadOnly") === "true"
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50")
    const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0")

    // The page and the unread count don't depend on each other: one round trip.
    const [notifications, unreadCount] = await Promise.all([
      unreadOnly
        ? sql`
            SELECT id, type, title, body, data, is_read, read_at, sent_at, created_at
            FROM notifications
            WHERE user_id = ${user.id} AND is_read = false
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `
        : sql`
            SELECT id, type, title, body, data, is_read, read_at, sent_at, created_at
            FROM notifications
            WHERE user_id = ${user.id}
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `,
      sql`
        SELECT COUNT(*) as count FROM notifications
        WHERE user_id = ${user.id} AND is_read = false
      `,
    ])

    return NextResponse.json({
      success: true,
      data: {
        notifications: notifications.map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          data: n.data,
          isRead: n.is_read,
          readAt: n.read_at,
          sentAt: n.sent_at,
          createdAt: n.created_at,
        })),
        unreadCount: Number(unreadCount[0].count),
      },
    })
  } catch (error) {
    console.error("Get notifications error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get notifications" },
      { status: 500 }
    )
  }
}

// Create a notification (for internal use and testing)
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { type = 'DEFAULT', title, body: notifBody, data = {} } = body

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required" },
        { status: 400 }
      )
    }

    // Valid notification types from enum
    const validTypes = [
      'EVENT_REMINDER', 'EVENT_INVITATION', 'EVENT_UPDATE', 'EVENT_APPROVAL_REQUEST', 
      'EVENT_APPROVED', 'EVENT_REJECTED', 'EVENT_CREATED',
      'LOCATION_ALERT', 'GEOFENCE_ALERT', 
      'FAMILY_INVITATION', 'FAMILY_INVITE',
      'TASK_ASSIGNED', 'TASK_COMPLETED', 'TASK_OVERDUE',
      'APPROVAL_REQUEST', 'APPROVAL_RESPONSE',
      'SUBSCRIPTION_ALERT', 'SYSTEM'
    ]
    const notificationType = validTypes.includes(type) ? type : 'SYSTEM'
    
    const notification = await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at)
      VALUES (
        ${'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)},
        ${user.id},
        ${notificationType},
        ${title},
        ${notifBody || ''},
        ${JSON.stringify(data)}::jsonb,
        false,
        NOW()
      )
      RETURNING *
    `

    return NextResponse.json({
      success: true,
      data: notification[0],
    })
  } catch (error) {
    console.error("Create notification error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create notification" },
      { status: 500 }
    )
  }
}

// Mark notifications as read
export async function PATCH(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { notificationId, notificationIds, markAllRead } = body

    if (markAllRead) {
      await sql`
        UPDATE notifications 
        SET is_read = true, read_at = NOW()
        WHERE user_id = ${user.id} AND is_read = false
      `
    } else if (notificationId) {
      // Handle single notification ID
      await sql`
        UPDATE notifications 
        SET is_read = true, read_at = NOW()
        WHERE user_id = ${user.id} AND id = ${notificationId}
      `
    } else if (notificationIds && Array.isArray(notificationIds)) {
      // Handle array of notification IDs
      await sql`
        UPDATE notifications 
        SET is_read = true, read_at = NOW()
        WHERE user_id = ${user.id} AND id = ANY(${notificationIds})
      `
    }

    return NextResponse.json({
      success: true,
      message: "Notifications marked as read",
    })
  } catch (error) {
    console.error("Mark notifications error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to mark notifications" },
      { status: 500 }
    )
  }
}
