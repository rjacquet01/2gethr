import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { notifyTaskCompleted, createNotification } from '@/lib/notifications'
import { ensureTaskEventNotifyChannelsColumns } from '@/lib/notify-channels-schema'

// Helper to sync task status updates across all related tables
async function syncTaskStatusUpdate(
  taskId: string,
  newStatus: string,
  userId: string,
  task: Record<string, unknown>,
  additionalData: Record<string, unknown> = {}
) {
  // 1. Google Tasks sync: nothing to do here. tasks.updated_at has already been
  // bumped by the caller, and the sync's push loop sends any task whose
  // updated_at is newer than synced_tasks.last_synced_at. This used to set
  // last_synced_at = NULL, which made the pull step treat Google's copy as
  // "newer than never" and overwrite the status we had just saved (reverting
  // In Progress / Hold / Complete back to Pending on the next auto-sync).

  // 2. Create status change notification for relevant users
  const notifyUsers: string[] = []
  
  // Notify task creator if they didn't make the change
  if (task.created_by_id && task.created_by_id !== userId) {
    notifyUsers.push(task.created_by_id as string)
  }
  
  // Notify assigned user if they didn't make the change
  if (task.assigned_to_id && task.assigned_to_id !== userId && task.assigned_to_id !== task.created_by_id) {
    notifyUsers.push(task.assigned_to_id as string)
  }
  
  // Create notifications for status changes
  const statusMessages: Record<string, string> = {
    'IN_PROGRESS': 'has been started',
    'ON_HOLD': 'has been put on hold',
    'COMPLETED': 'has been completed',
    'APPROVED': 'has been approved',
    'REJECTED': 'has been rejected',
    'CANCELLED': 'has been cancelled',
    'PENDING': 'has been set to pending',
    'ARCHIVED': 'has been archived'
  }
  
  const statusMessage = statusMessages[newStatus] || `status changed to ${newStatus}`
  
  // Look up the display name of whoever made the change, for the email/notification body.
  // users has first_name/last_name, not a single "name" column - selecting
  // "name" threw a Postgres "column does not exist" error that was
  // uncaught here, so EVERY task status change (complete/approve/reject/
  // start/hold/resume/pending/cancel/archive/unarchive) 500'd with
  // "Failed to update task" since this line was added.
  const changedByUser = await sql`SELECT first_name, last_name FROM users WHERE id = ${userId}`
  const changedByName = changedByUser[0]
    ? `${changedByUser[0].first_name || ''} ${changedByUser[0].last_name || ''}`.trim() || 'Someone'
    : 'Someone'

  for (const notifyUserId of notifyUsers) {
    await createNotification({
      userId: notifyUserId,
      type: 'TASK_ASSIGNED',
      title: `Task ${statusMessage}`,
      body: `"${task.title}" ${statusMessage}`,
      // sendEmail: true routes this through createNotification's email path
      // (lib/notifications.ts), gated on the recipient's own
      // reminder_settings.email_enabled - previously no task status change
      // ever produced an email at all, only the in-app/push notification.
      sendEmail: true,
      data: {
        taskId,
        newStatus,
        taskTitle: task.title,
        changedBy: changedByName,
        familyId: task.family_id,
        ...additionalData
      }
    })
  }
  
  // 3. Update audit_logs for compliance tracking
  await sql`
    INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
    VALUES (
      ${crypto.randomUUID()},
      ${userId},
      'UPDATE',
      'task',
      ${taskId},
      ${JSON.stringify({ status: task.status })}::jsonb,
      ${JSON.stringify({ status: newStatus, ...additionalData })}::jsonb,
      NOW()
    )
  `
}

// GET - Get task details
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
    
    const task = await sql`
      SELECT t.*, 
             u_creator.first_name as creator_first_name, u_creator.last_name as creator_last_name,
             u_assignee.first_name as assignee_first_name, u_assignee.last_name as assignee_last_name,
             cp.display_name as child_display_name,
             f.name as family_name
      FROM tasks t
      LEFT JOIN users u_creator ON t.created_by_id = u_creator.id
      LEFT JOIN users u_assignee ON t.assigned_to_id = u_assignee.id
      LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
      LEFT JOIN families f ON t.family_id = f.id
      WHERE t.id = ${taskId}
    `
    
    if (task.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    
    // Verify user has access to this family
    const membership = await sql`
      SELECT 1 FROM family_members
      WHERE family_id = ${task[0].family_id} AND user_id = ${user.id} AND is_active = true
    `
    
    if (membership.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    
    // Get task history
    const history = await sql`
      SELECT th.*, u.first_name, u.last_name
      FROM task_history th
      LEFT JOIN users u ON th.user_id = u.id
      WHERE th.task_id = ${taskId}
      ORDER BY th.created_at DESC
    `
    
    // Get task comments
    const comments = await sql`
      SELECT tc.*, u.first_name, u.last_name
      FROM task_comments tc
      LEFT JOIN users u ON tc.user_id = u.id
      WHERE tc.task_id = ${taskId}
      ORDER BY tc.created_at ASC
    `
    
    return NextResponse.json({ 
      data: { 
        ...task[0], 
        history, 
        comments 
      } 
    })
  } catch (error) {
    console.error('Task GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 })
  }
}

// PATCH - Update task (status, details, approval)
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
    const body = await request.json()
    const { action, ...updates } = body
    
    // Get existing task
    const existingTask = await sql`SELECT * FROM tasks WHERE id = ${taskId}`
    
    if (existingTask.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    
    const task = existingTask[0]
    
    // Verify user has access
    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${task.family_id} AND user_id = ${user.id} AND is_active = true
    `
    
    if (membership.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    
    // Handle specific actions
    if (action === 'complete') {
      // Mark task as completed
      const newStatus = 'COMPLETED'
      
      await sql`
        UPDATE tasks SET 
          status = ${newStatus},
          completed_at = NOW(),
          completed_by_id = ${user.id},
          updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'COMPLETED', ${JSON.stringify({ previousStatus: task.status, newStatus })}::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, newStatus, user.id, task, { completedAt: new Date().toISOString() })
      
      // Notify task creator and parents about completion
      const completedByName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Someone'
      
      // Notify task creator if different from completer
      if (task.created_by_id && task.created_by_id !== user.id) {
        await notifyTaskCompleted(task.created_by_id, task.title, taskId, task.family_id, completedByName)
      }
      
      // Notify all parents in the family
      const parents = await sql`
        SELECT fm.user_id
        FROM family_members fm
        WHERE fm.family_id = ${task.family_id}
          AND fm.is_active = true
          AND fm.role IN ('PARENT', 'GUARDIAN')
          AND fm.user_id != ${user.id}
          AND fm.user_id != ${task.created_by_id || user.id}
      `
      for (const parent of parents) {
        await notifyTaskCompleted(parent.user_id, task.title, taskId, task.family_id, completedByName)
      }
      
      return NextResponse.json({ success: true, status: newStatus })
    }
    
    if (action === 'approve') {
      // Only task creator or family owner can approve
      const isCreator = task.created_by_id === user.id
      const isOwner = membership[0].role === 'owner'
      
      if (!isCreator && !isOwner) {
        return NextResponse.json({ error: 'Only task creator or family owner can approve' }, { status: 403 })
      }
      
      await sql`
        UPDATE tasks SET 
          status = 'APPROVED',
          approved_by_id = ${user.id},
          approved_at = NOW(),
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'APPROVED', ${JSON.stringify({ approvedBy: user.id })}::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'APPROVED', user.id, task, { approvedBy: user.id })
      
      return NextResponse.json({ success: true, status: 'APPROVED' })
    }
    
    if (action === 'reject') {
      const isCreator = task.created_by_id === user.id
      const isOwner = membership[0].role === 'owner'
      
      if (!isCreator && !isOwner) {
        return NextResponse.json({ error: 'Only task creator or family owner can reject' }, { status: 403 })
      }
      
      await sql`
        UPDATE tasks SET 
          status = 'REJECTED',
          rejection_reason = ${updates.reason || null},
          updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'REJECTED', ${JSON.stringify({ reason: updates.reason || 'Not specified' })}::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'REJECTED', user.id, task, { reason: updates.reason })
      
      return NextResponse.json({ success: true, status: 'REJECTED' })
    }
    
    if (action === 'start') {
      await sql`
        UPDATE tasks SET status = 'IN_PROGRESS', updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'STARTED', '{}'::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'IN_PROGRESS', user.id, task)
      
      return NextResponse.json({ success: true, status: 'IN_PROGRESS' })
    }
    
    if (action === 'hold') {
      await sql`
        UPDATE tasks SET status = 'ON_HOLD', updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'ON_HOLD', ${JSON.stringify({ previousStatus: task.status })}::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'ON_HOLD', user.id, task)
      
      return NextResponse.json({ success: true, status: 'ON_HOLD' })
    }
    
    if (action === 'resume') {
      await sql`
        UPDATE tasks SET status = 'IN_PROGRESS', updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'RESUMED', '{}'::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'IN_PROGRESS', user.id, task, { resumedFrom: 'ON_HOLD' })
      
      return NextResponse.json({ success: true, status: 'IN_PROGRESS' })
    }
    
    if (action === 'pending') {
      await sql`
        UPDATE tasks SET status = 'PENDING', updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'SET_PENDING', ${JSON.stringify({ previousStatus: task.status })}::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'PENDING', user.id, task)
      
      return NextResponse.json({ success: true, status: 'PENDING' })
    }
    
    if (action === 'cancel') {
      await sql`
        UPDATE tasks SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'CANCELLED', ${JSON.stringify({ previousStatus: task.status })}::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'CANCELLED', user.id, task)
      
      return NextResponse.json({ success: true, status: 'CANCELLED' })
    }
    
    if (action === 'archive') {
      // Only allow archiving completed or cancelled tasks
      if (task.status !== 'COMPLETED' && task.status !== 'CANCELLED') {
        return NextResponse.json(
          { success: false, error: 'Only completed or cancelled tasks can be archived' },
          { status: 400 }
        )
      }
      
      await sql`
        UPDATE tasks SET status = 'ARCHIVED', updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'ARCHIVED', ${JSON.stringify({ previousStatus: task.status })}::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'ARCHIVED', user.id, task)
      
      return NextResponse.json({ success: true, status: 'ARCHIVED' })
    }
    
    if (action === 'unarchive') {
      if (task.status !== 'ARCHIVED') {
        return NextResponse.json(
          { success: false, error: 'Task is not archived' },
          { status: 400 }
        )
      }
      
      await sql`
        UPDATE tasks SET status = 'COMPLETED', updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, new_value)
        VALUES (${taskId}, ${user.id}, 'UNARCHIVED', '{}'::jsonb)
      `
      
      // Sync status update across all related tables
      await syncTaskStatusUpdate(taskId, 'COMPLETED', user.id, task, { unarchivedFrom: 'ARCHIVED' })
      
      return NextResponse.json({ success: true, status: 'COMPLETED' })
    }
    
    // General update (action = 'update' or any field updates)
    if (action === 'update' || updates.title || updates.description || updates.dueDate || updates.priority || updates.category || updates.assignedToUserId !== undefined || updates.assignedToChildId !== undefined || updates.requiresApproval !== undefined || updates.isRecurring !== undefined || updates.notifyChannels !== undefined) {
      await ensureTaskEventNotifyChannelsColumns()
      const cleanChannels: string[] | null = Array.isArray(updates.notifyChannels)
        ? (updates.notifyChannels as unknown[]).filter((c): c is string => typeof c === 'string' && ['in_app', 'push', 'email', 'sms'].includes(c))
        : null
      const changes: Record<string, unknown> = {}
      
      if (updates.title) {
        changes.title = { old: task.title, new: updates.title }
      }
      if (updates.description !== undefined) {
        changes.description = { old: task.description, new: updates.description }
      }
      if (updates.dueDate !== undefined) {
        changes.dueDate = { old: task.due_date, new: updates.dueDate }
      }
      if (updates.priority) {
        changes.priority = { old: task.priority, new: updates.priority }
      }
      if (updates.category) {
        changes.category = { old: task.category, new: updates.category }
      }
      if (updates.assignedToUserId !== undefined) {
        changes.assignedToUserId = { old: task.assigned_to_id, new: updates.assignedToUserId }
      }
      if (updates.assignedToChildId !== undefined) {
        changes.assignedToChildId = { old: task.child_profile_id, new: updates.assignedToChildId }
      }
      if (updates.isRecurring !== undefined) {
        changes.isRecurring = { old: task.is_recurring, new: updates.isRecurring }
      }
      
      await sql`
        UPDATE tasks SET 
          title = COALESCE(${updates.title || null}, title),
          description = ${updates.description !== undefined ? updates.description : task.description},
          due_date = ${updates.dueDate !== undefined ? updates.dueDate : task.due_date},
          priority = COALESCE(${updates.priority?.toUpperCase() || null}, priority),
          category = COALESCE(${updates.category?.toUpperCase() || null}, category),
          assigned_to_id = ${updates.assignedToUserId !== undefined ? updates.assignedToUserId : task.assigned_to_id},
          child_profile_id = ${updates.assignedToChildId !== undefined ? updates.assignedToChildId : task.child_profile_id},
          is_recurring = ${updates.isRecurring !== undefined ? updates.isRecurring : task.is_recurring},
          recurrence_rule = ${updates.recurrenceRule !== undefined ? updates.recurrenceRule : task.recurrence_rule},
          reminder_enabled = ${updates.reminderEnabled !== undefined ? updates.reminderEnabled : task.reminder_enabled},
          notify_channels = CASE WHEN ${Array.isArray(updates.notifyChannels)} THEN ${cleanChannels && cleanChannels.length > 0 ? cleanChannels : null}::text[] ELSE notify_channels END,
          updated_at = NOW()
        WHERE id = ${taskId}
      `
      
      await sql`
        INSERT INTO task_history (task_id, user_id, action, old_value, new_value)
        VALUES (${taskId}, ${user.id}, 'UPDATED', ${JSON.stringify({ title: task.title, description: task.description })}::jsonb, ${JSON.stringify(changes)}::jsonb)
      `
      
      return NextResponse.json({ success: true })
    }
    
    return NextResponse.json({ error: 'No valid action or updates provided' }, { status: 400 })
  } catch (error) {
    console.error('Task PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

// DELETE - Delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params
    
    const task = await sql`SELECT * FROM tasks WHERE id = ${taskId}`
    
    if (task.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    
    // Only creator or family owner can delete
    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${task[0].family_id} AND user_id = ${user.id} AND is_active = true
    `
    
    if (membership.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    
    const isCreator = task[0].created_by_id === user.id
    const isOwner = membership[0].role === 'owner'
    
    if (!isCreator && !isOwner) {
      return NextResponse.json({ error: 'Only task creator or family owner can delete' }, { status: 403 })
    }
    
    // Delete task history and comments first
    await sql`DELETE FROM task_history WHERE task_id = ${taskId}`
    await sql`DELETE FROM task_comments WHERE task_id = ${taskId}`
    await sql`DELETE FROM tasks WHERE id = ${taskId}`
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Task DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}
