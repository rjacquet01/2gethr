import { NextRequest, NextResponse } from 'next/server'
import { loginAdmin } from '@/lib/admin-auth'
import { clientIp, hitRateLimit, tooManyRequests } from '@/lib/rate-limit'

const ADMIN_LOGIN_WINDOW_SEC = 15 * 60
const ADMIN_LOGIN_LIMIT_PER_EMAIL = 10
const ADMIN_LOGIN_LIMIT_PER_IP = 20

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, mfaCode } = body
    
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password required' },
        { status: 400 }
      )
    }
    
    const ipAddress = clientIp(request)
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // On top of the per-account lockout in loginAdmin: guesses per email
    // (including ones with no account) and per IP (many accounts from one place).
    const byEmail = await hitRateLimit(`admin-login:email:${String(email).trim().toLowerCase()}`, ADMIN_LOGIN_LIMIT_PER_EMAIL, ADMIN_LOGIN_WINDOW_SEC)
    if (!byEmail.allowed) return tooManyRequests(byEmail.retryAfterSec, 'sign-in attempts')
    const byIp = await hitRateLimit(`admin-login:ip:${ipAddress}`, ADMIN_LOGIN_LIMIT_PER_IP, ADMIN_LOGIN_WINDOW_SEC)
    if (!byIp.allowed) return tooManyRequests(byIp.retryAfterSec, 'sign-in attempts')

    const result = await loginAdmin(email, password, ipAddress, userAgent, typeof mfaCode === 'string' ? mfaCode : undefined)

    // Password was right; the account needs its authenticator code too.
    if ('mfaRequired' in result) {
      return NextResponse.json({ mfaRequired: true })
    }
    
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 401 })
    }
    
    // Return tokens in response body (stored in localStorage on client)
    return NextResponse.json({
      admin: {
        id: result.admin.id,
        email: result.admin.email,
        firstName: result.admin.firstName,
        lastName: result.admin.lastName,
        roles: result.admin.roles,
        permissions: result.admin.permissions,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    })
  } catch (error) {
    console.error('[v0] Admin login error:', error)
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    )
  }
}
