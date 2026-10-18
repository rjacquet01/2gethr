import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  verifyRefreshToken,
  rotateRefreshToken,
  getUserWithFamily,
} from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get("refresh_token")?.value

    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: "No refresh token provided" },
        { status: 401 }
      )
    }

    // Verify JWT
    const payload = await verifyRefreshToken(refreshToken)
    if (!payload) {
      return NextResponse.json(
        { success: false, error: "Invalid refresh token" },
        { status: 401 }
      )
    }

    // Revoke the old token and issue a new pair in one statement. If another
    // request (another tab, the service worker) rotated this same token a
    // moment ago, this returns that request's new token rather than failing.
    // Device info is carried forward so a refreshed session still shows up
    // correctly in Settings > Security's session list.
    const newTokens = await rotateRefreshToken(refreshToken, payload.userId, {
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    if (!newTokens) {
      return NextResponse.json(
        { success: false, error: "Refresh token expired or revoked" },
        { status: 401 }
      )
    }

    // Get user data
    const user = await getUserWithFamily(payload.userId)

    // Create response and set cookies directly on it
    const response = NextResponse.json({
      success: true,
      data: {
        user,
        tokens: {
          accessToken: newTokens.accessToken,
          expiresIn: 15 * 60,
        },
      },
    })

    // Set cookies on response object (required for API routes)
    // secure in production; SameSite=Lax so other sites can't send requests with the session
    const isProduction = process.env.NODE_ENV === "production"
    response.cookies.set("access_token", newTokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 15 * 60, // 15 minutes
      path: "/",
    })
    response.cookies.set("refresh_token", newTokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    })

    return response
  } catch (error) {
    console.error("Token refresh error:", error)
    return NextResponse.json(
      { success: false, error: "Token refresh failed" },
      { status: 500 }
    )
  }
}
