import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import {
  verifyPassword,
  generateTokenPair,
  generateTwoFactorChallengeToken,
  getUserWithFamily,
  logAuditEvent,
} from "@/lib/auth"
import { z } from "zod"
import { recordFailedLogin } from "@/lib/login-attempts"
import { hitRateLimit, clientIp as requestIp, tooManyRequests } from "@/lib/rate-limit"

// Password guessing limits: per account and per network address.
const LOGIN_WINDOW_SEC = 15 * 60
const LOGIN_LIMIT_PER_EMAIL = 10
const LOGIN_LIMIT_PER_IP = 50

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = loginSchema.parse(body)

    const byEmail = await hitRateLimit(`login:email:${email.toLowerCase()}`, LOGIN_LIMIT_PER_EMAIL, LOGIN_WINDOW_SEC)
    if (!byEmail.allowed) return tooManyRequests(byEmail.retryAfterSec, "sign-in attempts")
    const byIp = await hitRateLimit(`login:ip:${requestIp(request)}`, LOGIN_LIMIT_PER_IP, LOGIN_WINDOW_SEC)
    if (!byIp.allowed) return tooManyRequests(byIp.retryAfterSec, "sign-in attempts")

    // Get user by email
    const users = await sql`
      SELECT id, password_hash, is_active, two_factor_enabled
      FROM users
      WHERE email = ${email.toLowerCase()}
    `

    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null

    if (users.length === 0) {
      await recordFailedLogin(email, null, clientIp)
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      )
    }

    const user = users[0]

    // Verify password (before the active check, so a wrong password can't
    // tell anyone whether an account exists and is deactivated)
    const isValidPassword = await verifyPassword(password, user.password_hash)
    if (!isValidPassword) {
      await recordFailedLogin(email, user.id, clientIp)
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      )
    }

    // Check if user is active
    if (!user.is_active) {
      return NextResponse.json(
        { success: false, error: "Account is deactivated" },
        { status: 403 }
      )
    }

    // If the user has 2FA enabled, don't issue real session tokens yet —
    // password alone is not enough to log in. Hand back a short-lived
    // challenge token instead; the client submits it plus a TOTP/backup
    // code to /api/auth/2fa/verify to actually complete the login.
    if (user.two_factor_enabled) {
      const challengeToken = await generateTwoFactorChallengeToken(user.id)
      return NextResponse.json({
        success: true,
        data: { requiresTwoFactor: true, challengeToken },
        message: "Two-factor authentication required",
      })
    }

    // Update last login
    await sql`
      UPDATE users
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = ${user.id}
    `

    // Generate tokens
    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined
    const userAgent = request.headers.get("user-agent") || undefined
    const tokens = await generateTokenPair(user.id, { ipAddress, userAgent })

    // Get full user with family info
    const userWithFamily = await getUserWithFamily(user.id)

    // Audit log
    await logAuditEvent(user.id, "LOGIN", "user", user.id, {
      ipAddress,
      userAgent,
    })

    // Create response - include both tokens for localStorage-based auth
    const response = NextResponse.json({
      success: true,
      data: {
        user: userWithFamily,
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: 15 * 60, // 15 minutes in seconds
        },
      },
      message: "Login successful",
    })

    // Set cookies on response object (required for API routes)
    // secure in production; SameSite=Lax so other sites can't send requests with the session
    const isProduction = process.env.NODE_ENV === "production"
    response.cookies.set("access_token", tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 15 * 60, // 15 minutes
      path: "/",
    })
    response.cookies.set("refresh_token", tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
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

    console.error("[v0] Login error:", error)
    return NextResponse.json(
      { success: false, error: "Sign-in failed. Please try again." }, // details stay in the server log
      { status: 500 }
    )
  }
}
