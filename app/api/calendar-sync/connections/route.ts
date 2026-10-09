import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { getUserFromRequest } from '@/lib/auth'
import { ensureSyncSchema } from '@/lib/sync-schema'

const sql = neon(process.env.DATABASE_URL!)

// GET - List user's calendar sync connections
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    await ensureSyncSchema()

    const connections = await sql`
      SELECT
        apple_task_calendar_url, id, provider, provider_account_email, external_calendar_id,
        sync_enabled, sync_direction, sync_tasks, sync_interval_minutes,
        task_sync_interval_minutes, last_sync_at,
        created_at, updated_at
      FROM calendar_sync_connections
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
    `

    return NextResponse.json({
      success: true,
      connections: connections.map(conn => ({
        id: conn.id,
        provider: conn.provider,
        calendarName: conn.provider_account_email || (conn.provider === 'google' ? 'Google Calendar' : 'Apple Calendar'),
        externalCalendarId: conn.external_calendar_id,
        syncEnabled: conn.sync_enabled,
        syncDirection: conn.sync_direction,
        syncTasks: conn.sync_tasks ?? false,
        appleTasksAvailable: !!conn.apple_task_calendar_url,
        syncIntervalMinutes: conn.sync_interval_minutes ?? 30,
        taskSyncIntervalMinutes: conn.task_sync_interval_minutes ?? 30,
        lastSyncedAt: conn.last_sync_at,
        createdAt: conn.created_at,
        updatedAt: conn.updated_at,
      })),
    })
  } catch (error) {
    console.error('Get connections error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch connections' },
      { status: 500 }
    )
  }
}

// DELETE - Disconnect a calendar sync
export async function DELETE(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    const { connectionId } = await request.json()

    if (!connectionId) {
      return NextResponse.json(
        { success: false, error: 'Connection ID required' },
        { status: 400 }
      )
    }

    // Verify the connection belongs to this user before touching any data
    // tied to it (previously this ownership check only happened on the final
    // delete, after other users' data could already have been removed).
    const owned = await sql`
      SELECT id FROM calendar_sync_connections
      WHERE id = ${connectionId} AND user_id = ${user.id}
    `

    if (owned.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Connection not found' },
        { status: 404 }
      )
    }

    // Delete synced events for this connection
    // BUG FIX: synced_events' foreign key to calendar_sync_connections is
    // named `connection_id` (see scripts/add-calendar-sync-tables.sql), not
    // `sync_connection_id` - the old column name here doesn't exist, so this
    // query always threw and disconnecting a calendar always failed.
    await sql`
      DELETE FROM synced_events
      WHERE connection_id = ${connectionId}
    `

    // Delete synced task mappings for this connection too
    await sql`
      DELETE FROM synced_tasks
      WHERE connection_id = ${connectionId}
    `

    // Delete the connection
    const result = await sql`
      DELETE FROM calendar_sync_connections
      WHERE id = ${connectionId} AND user_id = ${user.id}
      RETURNING id
    `

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Connection not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete connection error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete connection' },
      { status: 500 }
    )
  }
}

// PATCH - Update sync settings
export async function PATCH(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    const { connectionId, syncEnabled, syncDirection, syncIntervalMinutes, taskSyncIntervalMinutes, syncTasks } = await request.json()

    if (!connectionId) {
      return NextResponse.json(
        { success: false, error: 'Connection ID required' },
        { status: 400 }
      )
    }

    const ALLOWED_INTERVALS = [1, 10, 30, 60]

    if (syncIntervalMinutes !== undefined && !ALLOWED_INTERVALS.includes(syncIntervalMinutes)) {
      return NextResponse.json(
        { success: false, error: 'syncIntervalMinutes must be 1, 10, 30, or 60' },
        { status: 400 }
      )
    }

    if (taskSyncIntervalMinutes !== undefined && !ALLOWED_INTERVALS.includes(taskSyncIntervalMinutes)) {
      return NextResponse.json(
        { success: false, error: 'taskSyncIntervalMinutes must be 1, 10, 30, or 60' },
        { status: 400 }
      )
    }

    const values: Record<string, unknown> = { connectionId, userId: user.id }

    if (typeof syncEnabled === 'boolean') {
      values.syncEnabled = syncEnabled
    }
    if (syncDirection) {
      values.syncDirection = syncDirection
    }
    if (typeof syncIntervalMinutes === 'number') {
      values.syncIntervalMinutes = syncIntervalMinutes
    }
    if (typeof taskSyncIntervalMinutes === 'number') {
      values.taskSyncIntervalMinutes = taskSyncIntervalMinutes
    }
    if (typeof syncTasks === 'boolean') {
      values.syncTasks = syncTasks
    }

    const result = await sql`
      UPDATE calendar_sync_connections
      SET
        sync_enabled = COALESCE(${values.syncEnabled ?? null}::boolean, sync_enabled),
        sync_direction = COALESCE(${values.syncDirection ?? null}::text, sync_direction),
        sync_interval_minutes = COALESCE(${values.syncIntervalMinutes ?? null}::integer, sync_interval_minutes),
        task_sync_interval_minutes = COALESCE(${values.taskSyncIntervalMinutes ?? null}::integer, task_sync_interval_minutes),
        sync_tasks = COALESCE(${values.syncTasks ?? null}::boolean, sync_tasks),
        updated_at = NOW()
      WHERE id = ${connectionId} AND user_id = ${user.id}
      RETURNING id, sync_enabled, sync_direction, sync_interval_minutes, task_sync_interval_minutes, sync_tasks
    `

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Connection not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      connection: {
        id: result[0].id,
        syncEnabled: result[0].sync_enabled,
        syncDirection: result[0].sync_direction,
        syncIntervalMinutes: result[0].sync_interval_minutes,
        taskSyncIntervalMinutes: result[0].task_sync_interval_minutes,
        syncTasks: result[0].sync_tasks,
      },
    })
  } catch (error) {
    console.error('Update connection error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update connection' },
      { status: 500 }
    )
  }
}
