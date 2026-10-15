import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { getHistoryDays } from "@/lib/history-limit"

// POST - Archive all completed/cancelled tasks for the family
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Unauthorized" }, { status: 401 })
    }

    // Get family ID
    const familyMembership = await sql`
      SELECT family_id, role FROM family_members
      WHERE user_id = ${user.id} AND is_active = true
      LIMIT 1
    `

    if (familyMembership.length === 0) {
      return NextResponse.json({ success: false, error: "No family found" }, { status: 404 })
    }

    const familyId = familyMembership[0].family_id
    // A guest only archives tasks they created or are assigned to.
    const guestUserId: string | null = familyMembership[0].role === "GUEST" ? user.id : null

    // Archive all completed or cancelled tasks
    const result = await sql`
      UPDATE tasks
      SET status = 'ARCHIVED', updated_at = NOW()
      WHERE family_id = ${familyId}
      AND status IN ('COMPLETED', 'CANCELLED')
      AND (${guestUserId}::text IS NULL OR created_by_id = ${guestUserId} OR assigned_to_id = ${guestUserId})
      RETURNING id
    `

    // Log history for each archived task
    for (const task of result) {
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${task.id}, ${user.id}, 'ARCHIVED', '{"bulk": true}'::jsonb)
      `
    }

    return NextResponse.json({ 
      success: true, 
      archivedCount: result.length,
      message: `${result.length} task(s) archived`
    })
  } catch (error) {
    console.error("Bulk archive tasks error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to archive tasks" },
      { status: 500 }
    )
  }
}

// GET - Fetch archived tasks for the family
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Unauthorized" }, { status: 401 })
    }

    // Get family ID
    const familyMembership = await sql`
      SELECT family_id, role FROM family_members
      WHERE user_id = ${user.id} AND is_active = true
      LIMIT 1
    `

    if (familyMembership.length === 0) {
      return NextResponse.json({ success: false, error: "No family found" }, { status: 404 })
    }

    const familyId = familyMembership[0].family_id
    // Guests only see tasks they created or are assigned to.
    const guestUserId: string | null = familyMembership[0].role === "GUEST" ? user.id : null

    const historyDays = await getHistoryDays(familyId)

    // Fetch archived tasks (only those inside the plan's history window)
    const archivedTasks = await sql`
      SELECT
        t.id, t.title, t.description, t.status, t.priority, t.category,
        t.due_date, t.created_at, t.updated_at,
        u.first_name as creator_first_name, u.last_name as creator_last_name
      FROM tasks t
      LEFT JOIN users u ON t.created_by_id = u.id
      WHERE t.family_id = ${familyId}
      AND t.status = 'ARCHIVED'
      AND t.updated_at >= NOW() - make_interval(days => ${historyDays})
      AND (${guestUserId}::text IS NULL OR t.created_by_id = ${guestUserId} OR t.assigned_to_id = ${guestUserId})
      ORDER BY t.updated_at DESC
      LIMIT 100
    `

    const tasks = archivedTasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      category: t.category,
      dueDate: t.due_date,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      archivedAt: t.updated_at,
      creatorName: t.creator_first_name ? `${t.creator_first_name} ${t.creator_last_name || ''}`.trim() : null,
    }))

    return NextResponse.json({ success: true, tasks, historyDays })
  } catch (error) {
    console.error("Get archived tasks error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch archived tasks" },
      { status: 500 }
    )
  }
}
