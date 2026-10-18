import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { sql } from "@/lib/db"
import { clearAuthCookies, getUserFromRequest, logAuditEvent } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get("refresh_token")?.value
    // The web app also keeps a copy in localStorage and sends it here.
    let bodyToken: string | undefined
    try {
      const body = await request.json()
      if (typeof body?.refreshToken === "string") bodyToken = body.refreshToken
    } catch {
      // No body
    }

    // Revoke refresh token(s) in database
    for (const token of new Set([refreshToken, bodyToken].filter(Boolean) as string[])) {
      await sql`
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE token = ${token}
      `
    }

    // Clear cookies
    await clearAuthCookies()

    // Audit log
    if (user) {
      await logAuditEvent(user.id, "LOGOUT", "user", user.id, {
        ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      })
    }

    return NextResponse.json({
      success: true,
      message: "Logged out successfully",
    })
  } catch (error) {
    console.error("Logout error:", error)
    // Still clear cookies even if there's an error
    await clearAuthCookies()
    
    return NextResponse.json({
      success: true,
      message: "Logged out",
    })
  }
}
