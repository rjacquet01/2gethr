import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { syncAppleConnection, type AppleConnectionRow } from '@/lib/services/calendar-sync-core'
import { defaultFamilyFor } from '@/lib/permissions'

// POST - Manually trigger Apple Calendar sync (also called by the
// client-side auto-sync timer). Actual sync logic lives in
// lib/services/calendar-sync-core.ts, shared with the cron route.
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    const connections = await sql`
      SELECT id, access_token_encrypted, external_calendar_id, apple_caldav_server,
             provider_account_email, sync_direction
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

    if (!connection.access_token_encrypted || !connection.external_calendar_id) {
      return NextResponse.json(
        { success: false, error: 'Apple Calendar isn\'t fully connected. Reconnect it with your Apple ID and an app-specific password.' },
        { status: 400 }
      )
    }

    // Owned family first, then a full (non-guest) membership: someone who is a
    // guest elsewhere and owns a family syncs into their own family.
    const familyMembershipDefault = await defaultFamilyFor(user.id)
    const familyMembership = familyMembershipDefault ? [{ family_id: familyMembershipDefault.familyId }] : []

    if (familyMembership.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No family found' },
        { status: 404 }
      )
    }

    const familyId = familyMembership[0].family_id

    const { imported, exported } = await syncAppleConnection(connection as AppleConnectionRow, familyId, user.id)

    return NextResponse.json({
      success: true,
      imported,
      exported,
      message: `Sync complete. Imported ${imported} events, exported ${exported} events.`,
    })
  } catch (error) {
    console.error('Apple sync error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to sync Apple Calendar' },
      { status: 500 }
    )
  }
}
