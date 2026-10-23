import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, verifyPassword, logAuditEvent } from "@/lib/auth"
import { disableTwoFactor } from "@/lib/services/two-factor"
import { hitRateLimit, tooManyRequests } from "@/lib/rate-limit"
import { z } from "zod"

const disableSchema = z.object({
  password: z.string().min(1, "Password is required"),
})

// Disabling 2FA requires re-entering the account password — otherwise
// anyone with a stolen, still-logged-in session (but not the password)
// could strip 2FA protection off the account.
export async function POST(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { password } = disableSchema.parse(body)

    // Shares the change-password budget: one limit on guessing this account's password.
    const limit = await hitRateLimit(`password-check:${user.id}`, 10, 15 * 60)
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec, "password attempts")

    const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`
    if (rows.length === 0 || !(await verifyPassword(password, rows[0].password_hash))) {
      return NextResponse.json({ success: false, error: "Incorrect password" }, { status: 401 })
    }

    await disableTwoFactor(user.id)

    await logAuditEvent(user.id, "UPDATE", "user", user.id, {
      metadata: { action: "2fa_disabled" },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }

    console.error("2FA disable error:", error)
    return NextResponse.json({ success: false, error: "Failed to disable 2FA" }, { status: 500 })
  }
}
