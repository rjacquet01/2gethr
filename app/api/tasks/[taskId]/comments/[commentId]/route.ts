import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { taskInvolvesUser } from '@/lib/guest-scope'

// DELETE - remove a task comment: its author, or a PARENT / the family owner.
// task_comments has no soft-delete column, so this removes the row.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; commentId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { taskId, commentId } = await params

    const task = await sql`SELECT family_id, assigned_to_id, created_by_id FROM tasks WHERE id = ${taskId}`
    if (task.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const membership = await sql`
      SELECT fm.role, (f.owner_id = ${user.id}) AS is_owner
      FROM family_members fm JOIN families f ON f.id = fm.family_id
      WHERE fm.family_id = ${task[0].family_id} AND fm.user_id = ${user.id} AND fm.is_active = true
    `
    if (membership.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (membership[0].role === 'GUEST' && !taskInvolvesUser(task[0], user.id)) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const existing = await sql`SELECT user_id FROM task_comments WHERE id = ${commentId} AND task_id = ${taskId}`
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }
    const canModerate = membership[0].role === 'PARENT' || membership[0].is_owner === true
    if (existing[0].user_id !== user.id && !canModerate) {
      return NextResponse.json({ error: 'You can only delete your own comments' }, { status: 403 })
    }

    await sql`DELETE FROM task_comments WHERE id = ${commentId}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Task comment DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
  }
}
