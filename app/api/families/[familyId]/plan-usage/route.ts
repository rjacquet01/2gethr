import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { getMemberAccess, guestForbidden } from "@/lib/permissions"
import { countUsage, evaluateLimit, limitTier, capFor, type PlanLimitKind } from "@/lib/tier-limits"

const KINDS: PlanLimitKind[] = ["eventsPerMonth", "activeReminders", "boardUploads", "locationSharers"]

// GET - how much of each plan cap the family is using, for the usage meters
// on the calendar, reminders and board ("9 of 15 events this month").
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    const access = await getMemberAccess(familyId, user.id)
    if (!access) {
      return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
    }
    if (access.isGuest) return guestForbidden()
    const { tier, trial } = await limitTier(familyId)
    const entries = await Promise.all(
      KINDS.map(async (kind) => {
        const used = capFor(tier, kind) === null ? 0 : await countUsage(familyId, kind)
        const r = evaluateLimit(kind, tier, trial, used)
        return [kind, { used: r.used, limit: r.limit, upgradeTo: r.upgradeTo }] as const
      })
    )
    return NextResponse.json({ success: true, data: { tier, trial, usage: Object.fromEntries(entries) } })
  } catch (error) {
    console.error("Plan usage error:", error)
    return NextResponse.json({ success: false, error: "Failed to load plan usage" }, { status: 500 })
  }
}
