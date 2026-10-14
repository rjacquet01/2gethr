import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription } from "@/lib/auth"
import {
  dispatchEmergencyAlert,
  ensureEmergencyAlertSchema,
  EMERGENCY_COOLDOWN_SECONDS,
  EMERGENCY_LIMIT_PER_CHILD,
  EMERGENCY_WINDOW_MINUTES,
} from "@/lib/emergency-alert"
import { z } from "zod"

export const maxDuration = 30

const schema = z.object({
  familyId: z.string().min(1).optional(),
  memberId: z.string().min(1, "Member ID is required"),
})

const ADULT_ROLES = ["PARENT", "GUARDIAN"]

// Who can this person alert, and are they allowed to? Drives the button.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

    const familyId = request.nextUrl.searchParams.get("familyId") || user.primaryFamily?.id
    if (!familyId) return NextResponse.json({ success: true, data: { eligible: false, reason: "NO_FAMILY", children: [] } })

    const me = await sql`
      SELECT role FROM family_members WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `
    if (me.length === 0 || !ADULT_ROLES.includes(me[0].role)) {
      return NextResponse.json({ success: true, data: { eligible: false, reason: "NOT_PARENT", children: [] } })
    }
    const kids = await sql`
      SELECT fm.id, COALESCE(NULLIF(fm.nickname, ''), u.first_name, 'Child') AS name
      FROM family_members fm
      JOIN users u ON u.id = fm.user_id
      WHERE fm.family_id = ${familyId} AND fm.role = 'CHILD' AND fm.is_active = true AND fm.user_id IS NOT NULL
    `
    const children = kids.map((k) => ({ memberId: k.id as string, name: k.name as string }))
    if (children.length === 0) {
      return NextResponse.json({ success: true, data: { eligible: false, reason: "NO_CHILDREN", children: [] } })
    }
    const sub = await checkFamilySubscription(familyId)
    if (!sub.features.phoneAlerts) {
      return NextResponse.json({ success: true, data: { eligible: false, reason: "UPGRADE", children } })
    }
    return NextResponse.json({ success: true, data: { eligible: true, children } })
  } catch (error) {
    console.error("Emergency alert eligibility error:", error)
    return NextResponse.json({ success: false, error: "Failed to check emergency alert" }, { status: 500 })
  }
}

// Parent/guardian -> child: "call or reply now". One alert per press (no repeats).
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

    const body = schema.parse(await request.json().catch(() => ({})))
    const familyId = body.familyId || user.primaryFamily?.id
    if (!familyId) return NextResponse.json({ success: false, error: "No family" }, { status: 400 })

    const rows = await sql`
      SELECT
        me.role AS my_role,
        t.id AS target_member_id, t.user_id AS target_user_id, t.role AS target_role
      FROM family_members me
      JOIN family_members t ON t.family_id = me.family_id AND t.id = ${body.memberId} AND t.is_active = true
      WHERE me.family_id = ${familyId} AND me.user_id = ${user.id} AND me.is_active = true
    `
    if (rows.length === 0) return NextResponse.json({ success: false, error: "Member not found in this family" }, { status: 404 })
    const row = rows[0]
    if (!ADULT_ROLES.includes(row.my_role)) {
      return NextResponse.json({ success: false, error: "Only a parent or guardian can send an emergency alert" }, { status: 403 })
    }
    if (row.target_role !== "CHILD") {
      return NextResponse.json({ success: false, error: "Emergency alerts can only be sent to a child" }, { status: 400 })
    }
    if (!row.target_user_id) {
      return NextResponse.json({ success: false, error: "This child does not have a linked account to receive alerts" }, { status: 400 })
    }

    const sub = await checkFamilySubscription(familyId)
    if (!sub.features.phoneAlerts) {
      return NextResponse.json(
        { success: false, error: "Emergency alerts require a Premium subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      )
    }

    await ensureEmergencyAlertSchema()
    const recent = await sql`
      SELECT created_at FROM emergency_alerts
      WHERE sender_user_id = ${user.id} AND child_member_id = ${row.target_member_id}
        AND created_at > NOW() - make_interval(mins => ${EMERGENCY_WINDOW_MINUTES}::int)
      ORDER BY created_at DESC
    `
    if (recent.length > 0) {
      const sinceLastSec = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000
      if (sinceLastSec < EMERGENCY_COOLDOWN_SECONDS) {
        const wait = Math.max(1, Math.ceil(EMERGENCY_COOLDOWN_SECONDS - sinceLastSec))
        return NextResponse.json(
          { success: false, error: `An alert was just sent. You can send another in ${wait} second${wait === 1 ? "" : "s"}.`, code: "COOLDOWN" },
          { status: 429 }
        )
      }
    }
    if (recent.length >= EMERGENCY_LIMIT_PER_CHILD) {
      return NextResponse.json(
        { success: false, error: `You've sent ${EMERGENCY_LIMIT_PER_CHILD} emergency alerts to this child in the last hour. Please call them or emergency services directly.`, code: "LIMIT" },
        { status: 429 }
      )
    }

    const alertId = `emg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    await sql`
      INSERT INTO emergency_alerts (id, family_id, sender_user_id, child_member_id, child_user_id)
      VALUES (${alertId}, ${familyId}, ${user.id}, ${row.target_member_id}, ${row.target_user_id})
    `
    const senderName = `${user.firstName || ""}`.trim() || "A parent"
    const result = await dispatchEmergencyAlert({ alertId, senderName, childUserId: row.target_user_id })
    const reached = result.sms === "sent" || result.push === "sent"
    return NextResponse.json({ success: true, data: { alertId, reached, ...result } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    }
    console.error("Emergency alert error:", error)
    return NextResponse.json({ success: false, error: "Failed to send emergency alert" }, { status: 500 })
  }
}
