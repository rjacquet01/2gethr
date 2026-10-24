import { NextRequest, NextResponse } from "next/server"
import { monitorCron } from "@/lib/cron-health"
import { sql } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { ensureAssignmentColumns } from "@/lib/assignment"

// Daily (see vercel.json): a task that has been ON_HOLD for 3+ days gets one
// notification to its assignee and its requester (creator). It fires once per
// hold - putting the task on hold again later starts a new 3-day clock.
const HOLD_DAYS = 3

function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== "production" // fail closed in production
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

async function runJob(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
    await ensureAssignmentColumns()

    const held = await sql`
      SELECT t.id, t.title, t.family_id, t.created_by_id,
             COALESCE(t.assigned_to_id, cfm.user_id) AS assignee_id,
             COALESCE((SELECT MAX(h.created_at) FROM task_history h WHERE h.task_id = t.id AND h.action = 'ON_HOLD'), t.updated_at) AS hold_at
      FROM tasks t
      LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
      LEFT JOIN family_members cfm ON cp.family_member_id = cfm.id
      WHERE UPPER(t.status) = 'ON_HOLD'
        AND (t.assignment_status IS NULL OR t.assignment_status = 'ACCEPTED')
    `
    const cutoff = Date.now() - HOLD_DAYS * 86400000
    const due = held.filter((t) => new Date(t.hold_at).getTime() <= cutoff)
    if (due.length === 0) {
      return NextResponse.json({ success: true, data: { onHold: held.length, notified: 0 } })
    }

    const prior = await sql`
      SELECT data->>'taskId' AS task_id, MAX(created_at) AS last_sent
      FROM notifications
      WHERE data->>'kind' = 'on_hold_3d'
      GROUP BY 1
    `
    const lastSent = new Map<string, number>(prior.map((p) => [p.task_id as string, new Date(p.last_sent).getTime()]))

    let notified = 0
    for (const t of due) {
      const sent = lastSent.get(t.id)
      if (sent && sent >= new Date(t.hold_at).getTime()) continue // already nudged for this hold
      const recipients = new Set<string>()
      if (t.assignee_id) recipients.add(t.assignee_id)
      if (t.created_by_id) recipients.add(t.created_by_id)
      for (const uid of recipients) {
        await createNotification({
          userId: uid,
          type: "REMINDER",
          title: "Task on hold for 3 days",
          body: `"${t.title}" has been on hold for ${HOLD_DAYS} days. Resume it, or cancel it if it's no longer needed.`,
          data: { kind: "on_hold_3d", taskId: t.id, familyId: t.family_id },
          sendEmail: true,
        })
        notified++
      }
    }

    return NextResponse.json({ success: true, data: { onHold: held.length, notified, timestamp: new Date().toISOString() } })
  } catch (error) {
    console.error("On-hold task reminder error:", error)
    return NextResponse.json({ success: false, error: "Failed to send on-hold reminders" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}

export const GET = monitorCron("task-on-hold", runJob)
