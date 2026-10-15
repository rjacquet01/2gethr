import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { notifyTaskComment } from '@/lib/notifications'
import { taskInvolvesUser } from '@/lib/guest-scope'
import { PAGE_SIZE_COMMENTS, authorInfo, parseCursor } from '@/lib/social'

// GET - latest 50 comments, oldest first, in the shared comment-thread shape.
// ?before=<created_at> pages back; ?since=<created_at> returns only newer ones.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { taskId } = await params

    const task = await sql`SELECT family_id, assigned_to_id, created_by_id FROM tasks WHERE id = ${taskId}`
    if (task.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${task[0].family_id} AND user_id = ${user.id} AND is_active = true
    `
    if (membership.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (membership[0].role === 'GUEST' && !taskInvolvesUser(task[0], user.id)) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const before = parseCursor(request.nextUrl.searchParams.get('before'))
    const since = parseCursor(request.nextUrl.searchParams.get('since'))
    const rows = await sql`
      SELECT id, user_id, message, created_at, updated_at
      FROM task_comments
      WHERE task_id = ${taskId}
        AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
        AND (${since}::timestamptz IS NULL OR created_at > ${since}::timestamptz)
      ORDER BY created_at DESC
      LIMIT ${PAGE_SIZE_COMMENTS + 1}
    `
    const hasMore = rows.length > PAGE_SIZE_COMMENTS
    const page = rows.slice(0, PAGE_SIZE_COMMENTS).reverse()
    const authors = await authorInfo(task[0].family_id, page.map((r) => r.user_id as string))
    return NextResponse.json({
      success: true,
      data: page.map((r) => ({
        id: r.id,
        userId: r.user_id,
        body: r.message,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        ...(authors.get(r.user_id as string) || { authorName: 'Family member', avatarUrl: null, color: null, emoji: null }),
      })),
      hasMore,
    })
  } catch (error) {
    console.error('Task comments GET error:', error)
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 })
  }
}

// POST - Add a comment to a task
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params
    // `content` is the original field; `body` is what the shared comment thread sends.
    const payload = await request.json()
    const content: string | undefined = payload.content ?? payload.body

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
    }

    // Verify task exists and user has access
    const task = await sql`
      SELECT family_id, assigned_to_id, created_by_id, title FROM tasks WHERE id = ${taskId}
    `

    if (task.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${task[0].family_id} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    // Guests only reach tasks they created or are assigned to.
    if (membership[0].role === 'GUEST' && !taskInvolvesUser(task[0], user.id)) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const commentId = crypto.randomUUID()
    const trimmedContent = content.trim()
    const comment = await sql`
      INSERT INTO task_comments (id, task_id, user_id, message, created_at)
      VALUES (${commentId}, ${taskId}, ${user.id}, ${trimmedContent}, NOW())
      RETURNING *
    `

    // Log comment in history
    await sql`
      INSERT INTO task_history (id, task_id, user_id, action, new_value, created_at)
      VALUES (${crypto.randomUUID()}, ${taskId}, ${user.id}, 'COMMENTED', ${JSON.stringify({ commentId: comment[0].id })}::jsonb, NOW())
    `

    // Notify the assignee and any parents/guardians in the family (excluding
    // the commenter themselves) that a new comment was posted.
    await notifyTaskComment({
      taskId,
      familyId: task[0].family_id,
      taskTitle: task[0].title,
      assignedToId: task[0].assigned_to_id,
      commenterId: user.id,
      commenterName: `${user.firstName} ${user.lastName}`.trim(),
      commentMessage: trimmedContent,
      action: 'added'
    })

    return NextResponse.json({ data: comment[0] }, { status: 201 })
  } catch (error) {
    console.error('Task comment POST error:', error)
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  }
}

// PATCH - Edit an existing comment. Only the comment's own author may edit
// it; editing re-notifies the same people who hear about a new comment
// (assignee + parents/guardians, excluding the editor).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params
    const { commentId, content } = await request.json()

    if (!commentId) {
      return NextResponse.json({ error: 'commentId is required' }, { status: 400 })
    }

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
    }

    const task = await sql`
      SELECT family_id, assigned_to_id, created_by_id, title FROM tasks WHERE id = ${taskId}
    `

    if (task.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${task[0].family_id} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (membership[0].role === 'GUEST' && !taskInvolvesUser(task[0], user.id)) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const existing = await sql`
      SELECT * FROM task_comments WHERE id = ${commentId} AND task_id = ${taskId}
    `

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    // Only the comment's own author can edit it.
    if (existing[0].user_id !== user.id) {
      return NextResponse.json({ error: 'You can only edit your own comments' }, { status: 403 })
    }

    const trimmedContent = content.trim()
    const updated = await sql`
      UPDATE task_comments
      SET message = ${trimmedContent}, updated_at = NOW()
      WHERE id = ${commentId}
      RETURNING *
    `

    await sql`
      INSERT INTO task_history (id, task_id, user_id, action, new_value, created_at)
      VALUES (${crypto.randomUUID()}, ${taskId}, ${user.id}, 'COMMENT_EDITED', ${JSON.stringify({ commentId })}::jsonb, NOW())
    `

    await notifyTaskComment({
      taskId,
      familyId: task[0].family_id,
      taskTitle: task[0].title,
      assignedToId: task[0].assigned_to_id,
      commenterId: user.id,
      commenterName: `${user.firstName} ${user.lastName}`.trim(),
      commentMessage: trimmedContent,
      action: 'updated'
    })

    return NextResponse.json({ data: updated[0] })
  } catch (error) {
    console.error('Task comment PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 })
  }
}
