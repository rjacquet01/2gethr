import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { ensureAssignmentColumns } from "@/lib/assignment"

// Weekly nudge (see vercel.json): every person who is the assignee OR the
// requester (creator) of an open task - PENDING, IN_PROGRESS or ON_HOLD -
// gets one summary notification. Tasks still waiting on approval/acceptance
// are skipped. Delivery follows each user's own notification settings.
function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== "production" // fail closed in production
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

type Bucket = { assigned: string[]; requested: string[]; familyId: string }

export async function GET(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
    await ensureAssignmentColumns()

    const tasks = await sql`
      SELECT t.id, t.title, t.family_id, t.created_by_id,
             COALESCE(t.assigned_to_id, cfm.user_id) AS assignee_id
      FROM tasks t
      LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
      LEFT JOIN family_members cfm ON cp.family_member_id = cfm.id
      WHERE UPPER(t.status) IN ('PENDING', 'IN_PROGRESS', 'ON_HOLD')
        AND (t.assignment_status IS NULL OR t.assignment_status = 'ACCEPTED')
      ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
    `

    const buckets = new Map<string, Bucket>()
    const get = (uid: string, familyId: string) => {
      let b = buckets.get(uid)
      if (!b) { b = { assigned: [], requested: [], familyId }; buckets.set(uid, b) }
      return b
    }
    for (const t of tasks) {
      if (t.assignee_id) get(t.assignee_id, t.family_id).assigned.push(t.title)
      if (t.created_by_id && t.created_by_id !== t.assignee_id) get(t.created_by_id, t.family_id).requested.push(t.title)
    }

    const recent = await sql`
      SELECT DISTINCT user_id FROM notifications
      WHERE data->>'kind' = 'weekly_tasks' AND created_at > NOW() - INTERVAL '6 days'
    `
    const alreadySent = new Set(recent.map((r) => r.user_id as string))

    const list = (titles: string[]) =>
      titles.slice(0, 5).map((x) => `"${x}"`).join(", ") + (titles.length > 5 ? `, +${titles.length - 5} more` : "")

    let sent = 0
    for (const [userId, b] of buckets) {
      if (alreadySent.has(userId)) continue
      const parts: string[] = []
      if (b.assigned.length) parts.push(`${b.assigned.length} assigned to you (${list(b.assigned)})`)
      if (b.requested.length) parts.push(`${b.requested.length} you requested (${list(b.requested)})`)
      if (!parts.length) continue
      await createNotification({
        userId,
        type: "REMINDER",
        title: "Weekly task reminder",
        body: `Open tasks: ${parts.join("; ")}`,
        data: { kind: "weekly_tasks", familyId: b.familyId },
        sendEmail: true,
      })
      sent++
    }

    return NextResponse.json({ success: true, data: { openTasks: tasks.length, usersNotified: sent, timestamp: new Date().toISOString() } })
  } catch (error) {
    console.error("Weekly task reminder error:", error)
    return NextResponse.json({ success: false, error: "Failed to send weekly task reminders" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
