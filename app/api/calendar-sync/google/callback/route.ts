import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { encrypt } from '@/lib/encryption'
import { defaultFamilyFor } from '@/lib/permissions'
import { verifyOAuthState, OAUTH_NONCE_COOKIE } from '@/lib/auth'
import { appUrl } from '@/lib/app-url'

const sql = neon(process.env.DATABASE_URL!)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = `${appUrl()}/api/calendar-sync/google/callback`

export async function GET(request: NextRequest) {
  // Every way out clears the nonce cookie: one flow, one use.
  const done = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url))
    res.cookies.set(OAUTH_NONCE_COOKIE, '', { path: '/api/calendar-sync/google/callback', maxAge: 0 })
    return res
  }
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      return done('/settings/calendar-sync?error=denied')
    }

    if (!code || !state) {
      return done('/settings/calendar-sync?error=missing_params')
    }

    // The state must be one we signed (see generateOAuthState), opened in the
    // browser that started the flow: a forged, expired or someone else's link
    // could otherwise attach a Google account to the wrong Togethr user.
    const userId = await verifyOAuthState(state, request.cookies.get(OAUTH_NONCE_COOKIE)?.value)
    if (!userId) {
      return done('/settings/calendar-sync?error=invalid_state')
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text()
      console.error('Token exchange failed:', errorData)
      return done('/settings/calendar-sync?error=token_exchange')
    }

    const tokens = await tokenResponse.json()

    // Get user's primary calendar info (id is the account's email address for
    // the "primary" calendar; summary is the human-readable display name)
    const calendarResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary',
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    )

    let externalCalendarId = 'primary'
    let accountEmail: string | null = null

    if (calendarResponse.ok) {
      const calendarData = await calendarResponse.json()
      externalCalendarId = calendarData.id || 'primary'
      // For the "primary" calendar, Google's `id` field IS the account email.
      accountEmail = calendarData.id || null
    }

    // BUG FIX: this route used to write to a `calendar_name` column that was
    // never part of the schema (see scripts/add-calendar-sync-tables.sql,
    // which only has `provider_account_email`), and omitted the required
    // `family_id` column entirely. Both mistakes made every insert/update
    // here fail outright, so a connection was never actually saved even
    // after the OAuth round-trip succeeded.

    // Find the user's active family (needed because calendar_sync_connections
    // has a NOT NULL family_id column tying the connection to a family).
    // Owned family first, then a full (non-guest) membership: someone who is a
    // guest elsewhere and owns a family syncs into their own family.
    const familyMembershipDefault = await defaultFamilyFor(userId)
    const familyMembership = familyMembershipDefault ? [{ family_id: familyMembershipDefault.familyId }] : []

    if (familyMembership.length === 0) {
      return done('/settings/calendar-sync?error=no_family')
    }

    const familyId = familyMembership[0].family_id

    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(tokens.access_token)
    const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null

    // Calculate token expiry
    const tokenExpiry = new Date(Date.now() + (tokens.expires_in * 1000))

    // Check if connection already exists
    const existing = await sql`
      SELECT id FROM calendar_sync_connections
      WHERE user_id = ${userId} AND provider = 'google'
    `

    if (existing.length > 0) {
      // Update existing connection
      await sql`
        UPDATE calendar_sync_connections
        SET
          access_token_encrypted = ${encryptedAccessToken},
          refresh_token_encrypted = ${encryptedRefreshToken},
          token_expires_at = ${tokenExpiry.toISOString()},
          external_calendar_id = ${externalCalendarId},
          provider_account_email = ${accountEmail},
          family_id = ${familyId},
          sync_enabled = true,
          updated_at = NOW()
        WHERE user_id = ${userId} AND provider = 'google'
      `
    } else {
      // Create new connection
      await sql`
        INSERT INTO calendar_sync_connections (
          user_id, family_id, provider, external_calendar_id, provider_account_email,
          access_token_encrypted, refresh_token_encrypted, token_expires_at,
          sync_enabled
        ) VALUES (
          ${userId}, ${familyId}, 'google', ${externalCalendarId}, ${accountEmail},
          ${encryptedAccessToken}, ${encryptedRefreshToken}, ${tokenExpiry.toISOString()},
          true
        )
      `
    }

    return done('/settings/calendar-sync?success=google')
  } catch (error) {
    console.error('Google callback error:', error)
    return done('/settings/calendar-sync?error=callback_failed')
  }
}
