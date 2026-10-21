import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { ensureEmergencyAlertSchema, notifyParentAcked } from "@/lib/emergency-alert"
import { z } from "zod"
import { guestForbidden, isGuestInFamily, isGuestOnly } from "@/lib/permissions"
import { actorNameInFamily } from "@/lib/member-names"

const schema = z.object({ alertId: z.string().min(1) })

// The child taps "I'm OK": records it once and tells the parent who sent the alert.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

    const { alertId } = schema.parse(await request.json().catch(() => ({})))
    await ensureEmergencyAlertSchema()
    // Alerts only ever go to a CHILD member, but block guests explicitly too.
    const fam = await sql`SELECT family_id FROM emergency_alerts WHERE id = ${alertId} AND child_user_id = ${user.id} LIMIT 1`
    if (fam[0] ? await isGuestInFamily(fam[0].family_id, user.id) : await isGuestOnly(user.id)) return guestForbidden()
    const updated = await sql`
      UPDATE emergency_alerts SET acked_at = NOW()
      WHERE id = ${alertId} AND child_user_id = ${user.id} AND acked_at IS NULL
      RETURNING sender_user_id
    `
    if (updated.length === 0) {
      // Not theirs, unknown, or already answered: nothing more to do.
      return NextResponse.json({ success: true, data: { alreadyAnswered: true } })
    }
    await notifyParentAcked(updated[0].sender_user_id, await actorNameInFamily(fam[0]?.family_id as string | undefined, user, "Your child"))
    return NextResponse.json({ success: true, data: { alreadyAnswered: false } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }
    console.error("Emergency ack error:", error)
    return NextResponse.json({ success: false, error: "Failed to record reply" }, { status: 500 })
  }
}
