import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { syncGoogleConnection } from '@/lib/services/calendar-sync-core'
import { defaultFamilyFor } from '@/lib/permissions'

// POST - Manually trigger sync (also called by the client-side auto-sync
// timer in components/calendar-auto-sync.tsx; the actual sync logic now
// lives in lib/services/calendar-sync-core.ts so it can also be driven by
// app/api/cron/calendar-sync/route.ts, which has no session to scope to)
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
      SELECT
        id, access_token_encrypted, refresh_token_encrypted,
        token_expires_at, external_calendar_id, sync_direction
      FROM calendar_sync_connections
      WHERE user_id = ${user.id}
      AND provider = 'google'
      AND sync_enabled = true
    `

    if (connections.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No Google Calendar connection found' },
        { status: 404 }
      )
    }

    const connection = connections[0]

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

    const { imported, exported } = await syncGoogleConnection(connection, familyId, user.id)

    return NextResponse.json({
      success: true,
      imported,
      exported,
      message: `Sync complete. Imported ${imported} events, exported ${exported} events.`,
    })
  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to sync calendar' },
      { status: 500 }
    )
  }
}
