import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { listChildrenWithoutConsent } from "@/lib/existing-user-confirmations"

// GET - children in the families this user manages that were added before
// consent was recorded (no consent record at all). Empty for everyone else.
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    const children = await listChildrenWithoutConsent(user.id)
    return NextResponse.json({ success: true, data: { children } })
  } catch (error) {
    console.error("Pending child consents error:", error)
    return NextResponse.json({ success: false, error: "Failed to load" }, { status: 500 })
  }
}
