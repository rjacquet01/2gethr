import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { confirmEnrollment } from "@/lib/services/two-factor"
import { notifyAccountChange, requestIp } from "@/lib/admin-account-alerts"
import { z } from "zod"

const enableSchema = z.object({
  code: z.string().min(6).max(6),
})

// Confirms enrollment (started via /api/auth/2fa/setup) with a code from
// the user's authenticator app, turning 2FA on and returning one-time
// backup codes that are shown to the user exactly once.
export async function POST(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { code } = enableSchema.parse(body)

    const result = await confirmEnrollment(user.id, code)
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    await logAuditEvent(user.id, "UPDATE", "user", user.id, {
      metadata: { action: "2fa_enabled" },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    await notifyAccountChange({
      actor: user.email,
      actorType: "user",
      accountEmail: user.email,
      change: "Two-factor sign-in turned on",
      ipAddress: requestIp(request),
    })

    return NextResponse.json({ success: true, data: { backupCodes: result.backupCodes } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }

    console.error("2FA enable error:", error)
    return NextResponse.json({ success: false, error: "Failed to enable 2FA" }, { status: 500 })
  }
}
