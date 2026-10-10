import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import {
  getUserFromRequest,
  clearAuthCookies,
  revokeAllUserTokens,
  logAuditEvent,
} from '@/lib/auth'
import { closeUserAccount } from '@/lib/account-closure'

// Real account deletion, required by Google Play's Data Safety policy (the
// "Delete account URL" declared in the Play Console must lead to a working
// deletion flow - previously the Settings page button had no handler at all).
//
// This does NOT hard-delete the `users` row. Several tables reference
// users.id without ON DELETE CASCADE or SET NULL (events.created_by_id,
// event_requests.requestor_id/approver_id, families.owner_id), because
// events and requests are shared family data, not solely the deleting
// user's data - hard-deleting the row would either violate those foreign
// keys or silently destroy other family members' shared calendar history.
// Instead this scrubs every piece of personal data the user directly owns,
// revokes all access, and permanently deactivates the account so it can
// never be logged into again - the account is gone from the user's and
// their family's perspective, which is what the policy is after.
export async function POST(request: Request) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { confirmEmail } = body

    if (confirmEmail !== user.email) {
      return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
    }

    await closeUserAccount(user)

    await logAuditEvent(user.id, 'DELETE', 'user', user.id, {
      metadata: { reason: 'user_requested_account_deletion' },
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    })

    await clearAuthCookies()

    return NextResponse.json({
      success: true,
      message: 'Your account has been permanently deleted.',
    })
  } catch (error) {
    console.error('Account deletion error:', error)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
