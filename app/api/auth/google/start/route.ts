import { NextRequest, NextResponse } from "next/server"
import { generateOAuthState } from "@/lib/auth"
import { appUrl } from "@/lib/app-url"
import { hitRateLimit, clientIp } from "@/lib/rate-limit"
import {
  GOOGLE_AUTH_URL,
  GOOGLE_FLOW_MAX_AGE_SEC,
  GOOGLE_NEXT_COOKIE,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_SIGNIN_ENABLED,
  GOOGLE_STATE_SUBJECT,
  safeNextPath,
} from "@/lib/google-signin"

export const runtime = "nodejs"

const to = (path: string) => NextResponse.redirect(new URL(path, appUrl()))

// GET: send the browser to Google's account chooser. ?redirect=/path is where
// to land after signing in (same-site paths only).
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!GOOGLE_SIGNIN_ENABLED || !clientId) return to("/login?google=unavailable")

  const limit = await hitRateLimit(`google-start:${clientIp(request)}`, 30, 10 * 60)
  if (!limit.allowed) return to("/login?google=busy")

  // The nonce also goes in a cookie, so only this browser can finish the flow.
  const nonce = crypto.randomUUID()
  const state = await generateOAuthState(GOOGLE_STATE_SUBJECT, nonce)

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", `${appUrl()}/api/auth/google/callback`)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("prompt", "select_account")

  const res = NextResponse.redirect(url)
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth/google",
    maxAge: GOOGLE_FLOW_MAX_AGE_SEC,
  }
  res.cookies.set(GOOGLE_NONCE_COOKIE, nonce, cookie)
  res.cookies.set(GOOGLE_NEXT_COOKIE, safeNextPath(request.nextUrl.searchParams.get("redirect")), cookie)
  return res
}
