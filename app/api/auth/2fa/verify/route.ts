import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import {
  generateTokenPair,
  getUserWithFamily,
  logAuditEvent,
  verifyTwoFactorChallengeToken,
} from "@/lib/auth"
import { verifyLoginChallenge } from "@/lib/services/two-factor"
import { z } from "zod"
import { hitRateLimit, tooManyRequests } from "@/lib/rate-limit"

const verifySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(9), // 6-digit TOTP, or "XXXX-XXXX" backup code
})

// Completes a login that was paused for 2FA by /api/auth/login. Takes the
// short-lived challenge token issued there plus a TOTP/backup code, and on
// success mirrors exactly what /api/auth/login does for a non-2FA user:
// updates last_login_at, issues real session tokens, sets cookies.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { challengeToken, code } = verifySchema.parse(body)

    const payload = await verifyTwoFactorChallengeToken(challengeToken)
    if (!payload) {
      return NextResponse.json(
        { success: false, error: "Your session expired. Please log in again." },
        { status: 401 }
      )
    }

    // Per account, so getting a fresh challenge by signing in again doesn't
    // reset the count: 5 codes per 15 minutes.
    const limit = await hitRateLimit(`2fa:${payload.userId}`, 5, 15 * 60)
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec, "code attempts")

    const isValid = await verifyLoginChallenge(payload.userId, code)
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired code" },
        { status: 401 }
      )
    }

    await sql`
      UPDATE users
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = ${payload.userId}
    `

    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined
    const userAgent = request.headers.get("user-agent") || undefined
    const tokens = await generateTokenPair(payload.userId, { ipAddress, userAgent })
    const userWithFamily = await getUserWithFamily(payload.userId)

    await logAuditEvent(payload.userId, "LOGIN", "user", payload.userId, {
      metadata: { twoFactor: true },
      ipAddress,
      userAgent,
    })

    const response = NextResponse.json({
      success: true,
      data: {
        user: userWithFamily,
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: 15 * 60,
        },
      },
      message: "Login successful",
    })

    const isProduction = process.env.NODE_ENV === "production"
    response.cookies.set("access_token", tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 15 * 60,
      path: "/",
    })
    response.cookies.set("refresh_token", tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    })

    return response
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("2FA verify error:", error)
    return NextResponse.json(
      { success: false, error: "Verification failed" },
      { status: 500 }
    )
  }
}
