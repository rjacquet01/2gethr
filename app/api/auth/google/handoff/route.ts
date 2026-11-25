import { NextRequest, NextResponse } from "next/server"
import { getUserWithFamily, verifyRefreshToken } from "@/lib/auth"
import { GOOGLE_HANDOFF_COOKIE } from "@/lib/google-signin"

export const runtime = "nodejs"

// After a Google sign-in the session cookies are already set. The app also keeps
// its tokens client-side, so this hands them to /auth/google/done exactly once
// (the short-lived handoff cookie is deleted on use).
export async function POST(request: NextRequest) {
  const fail = () => NextResponse.json({ success: false, error: "Sign-in expired. Please try again." }, { status: 401 })

  if (!request.cookies.get(GOOGLE_HANDOFF_COOKIE)?.value) return fail()
  const accessToken = request.cookies.get("access_token")?.value
  const refreshToken = request.cookies.get("refresh_token")?.value
  if (!accessToken || !refreshToken) return fail()

  const payload = await verifyRefreshToken(refreshToken)
  if (!payload) return fail()
  const user = await getUserWithFamily(payload.userId as string)
  if (!user) return fail()

  const res = NextResponse.json({
    success: true,
    data: { user, tokens: { accessToken, refreshToken, expiresIn: 15 * 60 } },
  })
  res.cookies.set(GOOGLE_HANDOFF_COOKIE, "", { path: "/api/auth/google", maxAge: 0 })
  return res
}
