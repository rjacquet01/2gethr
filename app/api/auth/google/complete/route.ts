import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { generateTokenPair, hashPassword, logAuditEvent } from "@/lib/auth"
import { notifyAdmin, EMAIL_TEMPLATES } from "@/lib/services/email"
import { ensureConsentSchema } from "@/lib/consent-schema"
import { TERMS_VERSION } from "@/lib/consent-text"
import { hitRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit"
import { cleanSignupSource } from "@/lib/signup-source"
import { ensureSignupSourceColumns } from "@/lib/signup-source-schema"
import { GOOGLE_SIGNUP_COOKIE, ensureGoogleSchema, verifyGoogleSignup } from "@/lib/google-signin"

export const runtime = "nodejs"

const bodySchema = z.object({
  ageConfirmed: z.literal(true, { errorMap: () => ({ message: "You must be 18 or older to create a Togethr account. A parent can add children to their family." }) }),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "Please accept the Terms of Service and Privacy Policy" }) }),
  timezone: z.string().max(64).default("UTC"),
  signupSource: z.object({ source: z.string().max(80), campaign: z.string().max(120).optional() }).optional(),
})

// GET: who is finishing sign-up (shown on /register/google).
export async function GET(request: NextRequest) {
  const signup = await verifyGoogleSignup(request.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value)
  if (!signup) return NextResponse.json({ success: false, error: "Sign-in expired. Please start again." }, { status: 401 })
  return NextResponse.json({ success: true, data: { email: signup.email, name: signup.name } })
}

// POST: the person confirmed they are 18+ and accept the Terms; create the account.
export async function POST(request: NextRequest) {
  try {
    const signup = await verifyGoogleSignup(request.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value)
    if (!signup) return NextResponse.json({ success: false, error: "Sign-in expired. Please start again." }, { status: 401 })

    const body = bodySchema.parse(await request.json())

    const byIp = await hitRateLimit(`register:ip:${clientIp(request)}`, 10, 60 * 60)
    if (!byIp.allowed) return tooManyRequests(byIp.retryAfterSec, "sign-ups from this network")

    await ensureGoogleSchema()
    await ensureConsentSchema()

    const email = signup.email.toLowerCase()
    const existing = await sql`SELECT id FROM users WHERE email = ${email} OR google_sub = ${signup.sub}`
    if (existing.length > 0) {
      return NextResponse.json({ success: false, error: "Email already registered" }, { status: 409 })
    }

    const firstName = signup.givenName || signup.name?.split(" ")[0] || "User"
    const lastName = signup.familyName || signup.name?.split(" ").slice(1).join(" ") || ""
    const userId = crypto.randomUUID()
    // password_hash is NOT NULL; this one is random and never shown, so the account
    // signs in with Google (or "Forgot password" if they later want a password).
    const passwordHash = await hashPassword(`${crypto.randomUUID()}${crypto.randomUUID()}Aa1`)
    const nowIso = new Date().toISOString()

    await sql`
      INSERT INTO users (
        id, email, password_hash, first_name, last_name, timezone, is_active,
        email_verified, google_sub, created_at, updated_at,
        age_confirmed_at, terms_accepted_at, terms_version
      )
      VALUES (
        ${userId}, ${email}, ${passwordHash}, ${firstName}, ${lastName}, ${body.timezone}, true,
        NOW(), ${signup.sub}, NOW(), NOW(),
        ${nowIso}, ${nowIso}, ${TERMS_VERSION}
      )
    `

    const src = cleanSignupSource(body.signupSource) ?? { source: "direct" }
    try {
      await ensureSignupSourceColumns()
      await sql`UPDATE users SET signup_source = ${src.source}, signup_campaign = ${src.campaign ?? null} WHERE id = ${userId}`
    } catch (err) {
      console.error("[google-signin] signup source not saved:", err)
    }

    await sql`
      INSERT INTO reminder_settings (id, user_id, push_enabled, email_enabled, default_reminder_minutes, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${userId}, true, true, ${[15, 60]}, NOW(), NOW())
    `

    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined
    const userAgent = request.headers.get("user-agent") || undefined
    const consentIp = clientIp(request) === "unknown" ? null : clientIp(request)
    for (const type of ["TERMS_OF_SERVICE", "PRIVACY_POLICY"]) {
      await sql`
        INSERT INTO consents (id, user_id, type, granted, ip_address, user_agent, granted_at, version)
        VALUES (${crypto.randomUUID()}, ${userId}, ${type}, true, ${consentIp}, ${userAgent ?? null}, NOW(), ${TERMS_VERSION})
      `
    }
    await logAuditEvent(userId, "CREATE", "user", userId, { newValue: { email, method: "google" }, ipAddress, userAgent })
    await logAuditEvent(userId, "CREATE", "age_and_terms", userId, {
      newValue: { ageConfirmed: true, termsAccepted: true, termsVersion: TERMS_VERSION },
      ipAddress,
      userAgent,
    })

    const notice = EMAIL_TEMPLATES.ADMIN_NEW_SIGNUP(email, `${firstName} ${lastName}`.trim())
    await notifyAdmin(notice.subject, notice.html, notice.text)

    const tokens = await generateTokenPair(userId, { ipAddress, userAgent })
    const response = NextResponse.json({
      success: true,
      data: {
        user: { id: userId, email, firstName, lastName },
        linkedFamily: null,
        tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: 15 * 60 },
      },
      message: "Registration successful",
    })
    const secure = process.env.NODE_ENV === "production"
    response.cookies.set("access_token", tokens.accessToken, { httpOnly: true, secure, sameSite: "lax", maxAge: 15 * 60, path: "/" })
    response.cookies.set("refresh_token", tokens.refreshToken, { httpOnly: true, secure, sameSite: "lax", maxAge: 7 * 24 * 60 * 60, path: "/" })
    response.cookies.set(GOOGLE_SIGNUP_COOKIE, "", { path: "/api/auth/google", maxAge: 0 })
    return response
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }
    console.error("[google-signin] complete error:", error)
    return NextResponse.json({ success: false, error: "Registration failed. Please try again." }, { status: 500 })
  }
}
