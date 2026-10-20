import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { canManageFamily } from "@/lib/permissions"
import { listParentalConsents, withdrawChildConsent } from "@/lib/parental-consent"

type Params = { params: Promise<{ familyId: string; memberId: string }> }

async function guard(request: NextRequest, familyId: string, memberId: string) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) return { ok: false as const, res: NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 }) }
  if (!(await canManageFamily(familyId, user.id))) {
    return { ok: false as const, res: NextResponse.json({ success: false, error: "Only a parent or the family owner can manage a child's consent" }, { status: 403 }) }
  }
  const child = await sql`
    SELECT fm.id, cp.display_name FROM family_members fm
    LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
    WHERE fm.id = ${memberId} AND fm.family_id = ${familyId} AND fm.role = 'CHILD'
    LIMIT 1
  `
  if (child.length === 0) return { ok: false as const, res: NextResponse.json({ success: false, error: "Child not found" }, { status: 404 }) }
  return { ok: true as const, user, childName: (child[0].display_name as string) || "This child" }
}

// GET - the parental consent records for this child (who, when, what text).
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { familyId, memberId } = await params
    const g = await guard(request, familyId, memberId)
    if (!g.ok) return g.res
    const records = await listParentalConsents(familyId, memberId)
    return NextResponse.json({ success: true, data: { childName: g.childName, records } })
  } catch (error) {
    console.error("Get child consent error:", error)
    return NextResponse.json({ success: false, error: "Failed to load consent" }, { status: 500 })
  }
}

const withdrawSchema = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: "Confirm that you want to withdraw consent and delete this child's data" }) }),
})

// DELETE { confirm: true } - withdraw consent: the child's profile, login (if
// any), location settings and history are deleted. The consent record stays,
// marked withdrawn.
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { familyId, memberId } = await params
    const g = await guard(request, familyId, memberId)
    if (!g.ok) return g.res
    withdrawSchema.parse(await request.json().catch(() => ({})))

    const result = await withdrawChildConsent({ familyId, childMemberId: memberId, withdrawnBy: g.user.id })
    await logAuditEvent(g.user.id, "DELETE", "parental_consent_withdrawn", memberId, {
      newValue: { familyId, childMemberId: memberId, closedChildUserId: result.closedUserId },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    return NextResponse.json({
      success: true,
      data: { deleted: result.deleted },
      message: `Consent withdrawn. ${g.childName}'s data has been deleted.`,
    })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Withdraw child consent error:", error)
    return NextResponse.json({ success: false, error: "Failed to withdraw consent" }, { status: 500 })
  }
}
