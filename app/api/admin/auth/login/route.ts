import { NextRequest, NextResponse } from 'next/server'
import { loginAdmin } from '@/lib/admin-auth'

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
    
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                      request.headers.get('x-real-ip') || 
                      'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'
    
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
