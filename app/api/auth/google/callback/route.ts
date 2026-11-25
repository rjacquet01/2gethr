import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { generateTokenPair, logAuditEvent, verifyOAuthState } from "@/lib/auth"
import { appUrl } from "@/lib/app-url"
import { hitRateLimit, clientIp } from "@/lib/rate-limit"
import {
  GOOGLE_FLOW_MAX_AGE_SEC,
  GOOGLE_HANDOFF_COOKIE,
  GOOGLE_HANDOFF_MAX_AGE_SEC,
  GOOGLE_NEXT_COOKIE,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_SIGNIN_ENABLED,
  GOOGLE_SIGNUP_COOKIE,
  GOOGLE_STATE_SUBJECT,
  GOOGLE_TOKEN_URL,
  ensureGoogleSchema,
  safeNextPath,
  signGoogleSignup,
  verifyGoogleIdToken,
} from "@/lib/google-signin"

export const runtime = "nodejs"

// Google sends the browser back here. Outcomes, all as redirects:
//  - a Google account already linked to a Togethr account: signed in
//  - an email that already has a password account: back to /login to use the password
//  - a new email: to /register/google to confirm 18+ and the Terms first
export async function GET(request: NextRequest) {
  const finish = (path: string, extra?: (res: NextResponse) => void) => {
    const res = NextResponse.redirect(new URL(path, appUrl()))
    res.cookies.set(GOOGLE_NONCE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 })
    res.cookies.set(GOOGLE_NEXT_COOKIE, "", { path: "/api/auth/google", maxAge: 0 })
    extra?.(res)
    return res
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!GOOGLE_SIGNIN_ENABLED || !clientId || !clientSecret) return finish("/login?google=unavailable")

    const limit = await hitRateLimit(`google-callback:${clientIp(request)}`, 30, 10 * 60)
    if (!limit.allowed) return finish("/login?google=busy")

    const params = request.nextUrl.searchParams
    if (params.get("error")) return finish("/login?google=cancelled")

    const code = params.get("code")
    const state = params.get("state")
    if (!code || !state) return finish("/login?google=error")
    const subject = await verifyOAuthState(state, request.cookies.get(GOOGLE_NONCE_COOKIE)?.value)
    if (subject !== GOOGLE_STATE_SUBJECT) return finish("/login?google=error")
    const next = safeNextPath(request.cookies.get(GOOGLE_NEXT_COOKIE)?.value)

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appUrl()}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    })
    if (!tokenRes.ok) {
      console.error("[google-signin] token exchange failed:", tokenRes.status)
      return finish("/login?google=error")
    }
    const tokenJson = (await tokenRes.json()) as { id_token?: string }
    const identity = tokenJson.id_token ? await verifyGoogleIdToken(tokenJson.id_token, clientId) : null
    if (!identity) return finish("/login?google=unverified")

    await ensureGoogleSchema()

    // 1. This Google account is already linked.
    const linked = await sql`
      SELECT id, is_active, two_factor_enabled FROM users WHERE google_sub = ${identity.sub}
    `
    if (linked.length > 0) {
      const user = linked[0]
      if (!user.is_active) return finish("/login?google=deactivated")
      // The authenticator step lives on the password sign-in form.
      if (user.two_factor_enabled) return finish("/login?google=2fa")

      await sql`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ${user.id}`
      const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined
      const userAgent = request.headers.get("user-agent") || undefined
      const tokens = await generateTokenPair(user.id, { ipAddress, userAgent })
      await logAuditEvent(user.id, "LOGIN", "user", user.id, { ipAddress, userAgent, metadata: { method: "google" } })

      const secure = process.env.NODE_ENV === "production"
      return finish(`/auth/google/done?next=${encodeURIComponent(next)}`, (res) => {
        res.cookies.set("access_token", tokens.accessToken, { httpOnly: true, secure, sameSite: "lax", maxAge: 15 * 60, path: "/" })
        res.cookies.set("refresh_token", tokens.refreshToken, { httpOnly: true, secure, sameSite: "lax", maxAge: 7 * 24 * 60 * 60, path: "/" })
        // Lets /auth/google/done hand the session to the page (the app keeps its tokens client-side).
        res.cookies.set(GOOGLE_HANDOFF_COOKIE, "1", { httpOnly: true, secure, sameSite: "lax", maxAge: GOOGLE_HANDOFF_MAX_AGE_SEC, path: "/api/auth/google" })
      })
    }

    // 2. A password account already uses this email. Not linked automatically:
    // that email was never verified at sign-up, so the password owner could be someone else.
    const sameEmail = await sql`SELECT id FROM users WHERE email = ${identity.email}`
    if (sameEmail.length > 0) return finish("/login?google=exists")

    // 3. New to Togethr: confirm 18+ and the Terms before creating anything.
    const signup = await signGoogleSignup(identity)
    const secure = process.env.NODE_ENV === "production"
    return finish(`/register/google?next=${encodeURIComponent(next)}`, (res) => {
      res.cookies.set(GOOGLE_SIGNUP_COOKIE, signup, { httpOnly: true, secure, sameSite: "lax", maxAge: GOOGLE_FLOW_MAX_AGE_SEC, path: "/api/auth/google" })
    })
  } catch (error) {
    console.error("[google-signin] callback error:", (error as Error)?.name)
    return finish("/login?google=error")
  }
}
