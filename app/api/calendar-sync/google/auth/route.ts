import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, generateOAuthState, OAUTH_NONCE_COOKIE, OAUTH_NONCE_MAX_AGE_SEC } from '@/lib/auth'
import { appUrl } from '@/lib/app-url'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const REDIRECT_URI = `${appUrl()}/api/calendar-sync/google/callback`

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
].join(' ')

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    if (!GOOGLE_CLIENT_ID) {
      return NextResponse.json(
        { success: false, error: 'Google Calendar integration not configured' },
        { status: 500 }
      )
    }

    // Signed state: the callback only trusts a user id this server issued, and
    // only in the browser holding the matching nonce cookie set here.
    const nonce = crypto.randomUUID()
    const state = await generateOAuthState(user.id, nonce)

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('state', state)

    const res = NextResponse.json({
      success: true,
      authUrl: authUrl.toString()
    })
    res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/calendar-sync/google/callback',
      maxAge: OAUTH_NONCE_MAX_AGE_SEC,
    })
    return res
  } catch (error) {
    console.error('Google auth error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to generate auth URL' },
      { status: 500 }
    )
  }
}
