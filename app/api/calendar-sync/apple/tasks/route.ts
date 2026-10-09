import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { ensureSyncSchema } from '@/lib/sync-schema'
import { syncAppleReminders } from '@/lib/services/apple-reminders-sync'

// POST - Two-way sync of Togethr tasks and reminders with Apple Reminders
// (VTODO over CalDAV). The work lives in lib/services/apple-reminders-sync.ts,
// shared with the background cron.
export async function POST(request: NextRequest) {
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
      SELECT id, access_token_encrypted, apple_task_calendar_url, provider_account_email, sync_tasks
      FROM calendar_sync_connections
      WHERE user_id = ${user.id} AND provider = 'apple' AND sync_enabled = true
    `

    if (connections.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No Apple Calendar connection found' },
        { status: 404 }
      )
    }

    const connection = connections[0]

    if (!connection.sync_tasks) {
      return NextResponse.json(
        { success: false, error: 'Task sync is not enabled' },
        { status: 400 }
      )
    }

    const familyMembership = await sql`
      SELECT family_id FROM family_members
      WHERE user_id = ${user.id} AND is_active = true
      ORDER BY joined_at ASC
      LIMIT 1
    `

    if (familyMembership.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User is not part of any family' },
        { status: 400 }
      )
    }

    const r = await syncAppleReminders(connection as never, familyMembership[0].family_id, user.id)

    return NextResponse.json({
      success: true,
      synced: r.pushed + r.pulled + r.completedFromApple,
      ...r,
      message: `Sent ${r.pushed}, received ${r.pulled}, completed ${r.completedFromApple} from Apple Reminders${r.errors > 0 ? `, ${r.errors} error(s)` : ''}`,
    })
  } catch (error) {
    console.error('Apple task sync error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to sync tasks to Apple Reminders' },
      { status: 500 }
    )
  }
}
