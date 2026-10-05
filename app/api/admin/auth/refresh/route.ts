import { NextRequest, NextResponse } from 'next/server'
import { refreshAdminTokens } from '@/lib/admin-auth'

// Issues a new admin access/refresh token pair from a still-valid refresh
// token. This route previously didn't exist at all - lib/admin-auth.ts has
// had a working refreshAdminTokens() for a while, and the client
// (hooks/use-admin-auth.ts) already calls POST /api/admin/auth/refresh on a
// 401, but with no route here that call 404'd, so every admin session just
// died silently 15 minutes after login with no way to recover short of
// logging in again.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const refreshToken = body?.refreshToken

    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json({ error: 'Refresh token required' }, { status: 400 })
    }

    const result = await refreshAdminTokens(refreshToken)

    if (!result) {
      return NextResponse.json(
        { error: 'Invalid or expired refresh token' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    })
  } catch (error) {
    console.error('Admin token refresh error:', error)
    return NextResponse.json({ error: 'Failed to refresh token' }, { status: 500 })
  }
}
