import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest, checkFamilySubscription } from "@/lib/auth"
import { getMemberAccess } from "@/lib/permissions"
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-tiers"
import { loadActivity } from "@/lib/activity-feed"

export const runtime = "nodejs"

// GET ?familyId=&limit= : who added or changed what, newest first. Read only.
// Members only (not guests). Reaches back as far as the plan keeps past events.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

    const familyId = request.nextUrl.searchParams.get("familyId")
    if (!familyId) return NextResponse.json({ success: false, error: "familyId is required" }, { status: 400 })

    const access = await getMemberAccess(familyId, user.id)
    if (!access) return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
    if (access.role === "GUEST") return NextResponse.json({ success: false, error: "Not available for guest members" }, { status: 403 })

    const asked = Number(request.nextUrl.searchParams.get("limit"))
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 100) : 40

    const sub = await checkFamilySubscription(familyId)
    const days = sub.features.historyDays || SUBSCRIPTION_TIERS.FREE.limits.historyDays

    const items = await loadActivity(familyId, user.id, { days, limit })
    return NextResponse.json({ success: true, data: { items, days } })
  } catch (error) {
    console.error("[activity] error:", (error as Error)?.name)
    return NextResponse.json({ success: false, error: "Could not load activity" }, { status: 500 })
  }
}
