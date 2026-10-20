import { NextRequest, NextResponse } from 'next/server'
import {
  getAdminFromToken,
  verifyAdminToken,
  revokeAdminSessions,
  ADMIN_ACCESS_COOKIE,
  ADMIN_REFRESH_COOKIE,
} from '@/lib/admin-auth'

// The admin app keeps its tokens in localStorage and sends a Bearer header
// (hooks/use-admin-auth.ts) plus its refresh token in the body. Revoking the
// admin's sessions means their refresh token stops working at once; an access
// token already issued lasts at most its 15 minutes.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    let adminId = (token ? await getAdminFromToken(token, { allowWithoutMfa: true }) : null)?.id ?? null
    if (!adminId) {
      // Access token expired: a valid (signed) refresh token identifies them.
      const body = await request.json().catch(() => ({}))
      const refresh = typeof body?.refreshToken === 'string' ? await verifyAdminToken(body.refreshToken) : null
      if (refresh?.type === 'admin_refresh') adminId = refresh.sub
    }
    if (!adminId) {
      // Legacy cookie session.
      const cookieToken = request.cookies.get(ADMIN_ACCESS_COOKIE)?.value
      adminId = (cookieToken ? await getAdminFromToken(cookieToken, { allowWithoutMfa: true }) : null)?.id ?? null
    }

    if (adminId) await revokeAdminSessions(adminId)
  } catch (error) {
    console.error('Admin logout error:', error)
  }
  const response = NextResponse.json({ success: true })
  response.cookies.delete(ADMIN_ACCESS_COOKIE)
  response.cookies.delete(ADMIN_REFRESH_COOKIE)
  return response
}
