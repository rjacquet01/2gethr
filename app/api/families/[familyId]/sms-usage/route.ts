import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { getMemberAccess, guestForbidden } from "@/lib/permissions"
import { getSmsUsage } from "@/lib/services/sms"

// GET - texts sent this month and the family's monthly allowance, for
// Settings > Notifications ("SMS this month: 12 of 25").
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    const access = await getMemberAccess(familyId, user.id)
    if (!access) {
      return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
    }
    // The family's texting is family business, not a guest's.
    if (access.isGuest) return guestForbidden()
    return NextResponse.json({ success: true, data: await getSmsUsage(familyId) })
  } catch (error) {
    console.error("SMS usage error:", error)
    return NextResponse.json({ success: false, error: "Failed to load SMS usage" }, { status: 500 })
  }
}
