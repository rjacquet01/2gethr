import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { startEnrollment } from "@/lib/services/two-factor"
import { sql } from "@/lib/db"

// Starts (or restarts) 2FA enrollment for the logged-in user. Returns a QR
// code image URL plus the manual-entry secret; the user must then submit a
// code from their authenticator app to /api/auth/2fa/enable to actually
// turn 2FA on. Calling this again before confirming just replaces the
// pending secret — safe to retry if the QR didn't scan.
export async function POST(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Replacing an active secret must go through "turn off" first, which asks
    // for the password: otherwise a stolen session could enroll its own
    // authenticator and lock the owner out.
    const state = await sql`SELECT two_factor_enabled FROM users WHERE id = ${user.id}`
    if (state[0]?.two_factor_enabled) {
      return NextResponse.json(
        { success: false, error: "Two-factor authentication is already on. Turn it off first to set up a new device." },
        { status: 409 }
      )
    }
    const result = await startEnrollment(user.id, user.email)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error("2FA setup error:", error)
    return NextResponse.json({ success: false, error: "Failed to start 2FA setup" }, { status: 500 })
  }
}
