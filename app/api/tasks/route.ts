import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { ensureTaskEventNotifyChannelsColumns } from '@/lib/notify-channels-schema'
import { notifyTaskAssigned, type NotificationChannel } from '@/lib/notifications'

// GET - List tasks for the current user's families
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const familyId = searchParams.get('familyId')
    const status = searchParams.get('status')
    const assignedTo = searchParams.get('assignedTo')
    
    // Get user's family memberships
    const memberships = await sql`
      SELECT fm.family_id, fm.role FROM family_members fm
      WHERE fm.user_id = ${user.id} AND fm.is_active = true
    `
    
    if (memberships.length === 0) {
      return NextResponse.json({ data: [] })
    }
    
    // SECURITY FIX: previously a client-supplied familyId was trusted as-is,
    // letting any authenticated user list another family's tasks. Restrict to
    // families the user actually belongs to.
    const myFamilyIds = memberships.map((m: { family_id: string }) => m.family_id)
    if (familyId && !myFamilyIds.includes(familyId)) {
      return NextResponse.json({ error: 'Family not found or access denied' }, { status: 403 })
    }
    const familyIds = familyId ? [familyId] : myFamilyIds
    
    // Normalize status to uppercase to match DB values
    const normalizedStatus = status?.toUpperCase()
    
    let tasks
    
    if (normalizedStatus && normalizedStatus !== 'ALL' && assignedTo === 'me') {
      tasks = await sql`
        SELECT t.*, 
               u_creator.first_name as creator_first_name, u_creator.last_name as creator_last_name,
               u_assignee.first_name as assignee_first_name, u_assignee.last_name as assignee_last_name,
               u_assignee.profile_photo_path as assignee_profile_photo_path,
               cp.display_name as child_display_name, cp.avatar_url as child_avatar_url,
               f.name as family_name
        FROM tasks t
        LEFT JOIN users u_creator ON t.created_by_id = u_creator.id
        LEFT JOIN users u_assignee ON t.assigned_to_id = u_assignee.id
        LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
        LEFT JOIN families f ON t.family_id = f.id
        WHERE t.family_id = ANY(${familyIds})
        AND t.status = ${normalizedStatus}
        AND t.assigned_to_id = ${user.id}
        ORDER BY t.due_date ASC NULLS LAST, t.priority DESC, t.created_at DESC
      `
    } else if (normalizedStatus && normalizedStatus !== 'ALL') {
      tasks = await sql`
        SELECT t.*, 
               u_creator.first_name as creator_first_name, u_creator.last_name as creator_last_name,
               u_assignee.first_name as assignee_first_name, u_assignee.last_name as assignee_last_name,
               u_assignee.profile_photo_path as assignee_profile_photo_path,
               cp.display_name as child_display_name, cp.avatar_url as child_avatar_url,
               f.name as family_name
        FROM tasks t
        LEFT JOIN users u_creator ON t.created_by_id = u_creator.id
        LEFT JOIN users u_assignee ON t.assigned_to_id = u_assignee.id
        LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
        LEFT JOIN families f ON t.family_id = f.id
        WHERE t.family_id = ANY(${familyIds})
        AND t.status = ${normalizedStatus}
        ORDER BY t.due_date ASC NULLS LAST, t.priority DESC, t.created_at DESC
      `
    } else if (assignedTo === 'me') {
      tasks = await sql`
        SELECT t.*, 
               u_creator.first_name as creator_first_name, u_creator.last_name as creator_last_name,
               u_assignee.first_name as assignee_first_name, u_assignee.last_name as assignee_last_name,
               u_assignee.profile_photo_path as assignee_profile_photo_path,
               cp.display_name as child_display_name, cp.avatar_url as child_avatar_url,
               f.name as family_name
        FROM tasks t
        LEFT JOIN users u_creator ON t.created_by_id = u_creator.id
        LEFT JOIN users u_assignee ON t.assigned_to_id = u_assignee.id
        LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
        LEFT JOIN families f ON t.family_id = f.id
        WHERE t.family_id = ANY(${familyIds})
        AND t.assigned_to_id = ${user.id}
        ORDER BY t.due_date ASC NULLS LAST, t.priority DESC, t.created_at DESC
      `
    } else {
      tasks = await sql`
        SELECT t.*, 
               u_creator.first_name as creator_first_name, u_creator.last_name as creator_last_name,
               u_assignee.first_name as assignee_first_name, u_assignee.last_name as assignee_last_name,
               u_assignee.profile_photo_path as assignee_profile_photo_path,
               cp.display_name as child_display_name, cp.avatar_url as child_avatar_url,
               f.name as family_name
        FROM tasks t
        LEFT JOIN users u_creator ON t.created_by_id = u_creator.id
        LEFT JOIN users u_assignee ON t.assigned_to_id = u_assignee.id
        LEFT JOIN child_profiles cp ON t.child_profile_id = cp.id
        LEFT JOIN families f ON t.family_id = f.id
        WHERE t.family_id = ANY(${familyIds})
        ORDER BY t.due_date ASC NULLS LAST, t.priority DESC, t.created_at DESC
      `
    }
    
    return NextResponse.json({ data: tasks })
  } catch (error) {
    console.error('Tasks GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

// POST - Create a new task
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      familyId, 
      title, 
      description, 
      assignedToUserId, 
      assignedToChildId,
      dueDate,
      reminderAt,
      priority = 'medium',
      requiresApproval = false,
      category,
      isRecurring = false,
      recurrenceRule,
      notifyChannels
    } = body

    // Validate notifyChannels is either absent or a plain array of known
    // channel strings - this gets written straight into a TEXT[] column and
    // used downstream to gate which notification sends are attempted, so a
    // malformed value here shouldn't silently corrupt the column or later
    // throw on the recipient's behalf.
    const VALID_NOTIFY_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email', 'sms']
    const normalizedNotifyChannels: NotificationChannel[] | null =
      Array.isArray(notifyChannels) && notifyChannels.length > 0
        ? notifyChannels.filter((c: unknown): c is NotificationChannel =>
            typeof c === 'string' && (VALID_NOTIFY_CHANNELS as string[]).includes(c)
          )
        : null
    
    if (!familyId || !title) {
      return NextResponse.json({ error: 'Family ID and title are required' }, { status: 400 })
    }
    
    // Verify user is a member of the family
    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `
    
    if (membership.length === 0) {
      return NextResponse.json({ error: 'Not a member of this family' }, { status: 403 })
    }
    
    await ensureTaskEventNotifyChannelsColumns()

    // Create the task
    const task = await sql`
      INSERT INTO tasks (
        family_id, title, description, created_by_id,
        assigned_to_id, child_profile_id, due_date,
        priority, category, status, is_recurring, recurrence_rule,
        notify_channels
      ) VALUES (
        ${familyId}, ${title}, ${description || null}, ${user.id},
        ${assignedToUserId || null}, ${assignedToChildId || null},
        ${dueDate || null},
        ${priority.toUpperCase()}, ${category || 'CHORE'}, 'PENDING',
        ${isRecurring}, ${isRecurring ? recurrenceRule : null},
        ${normalizedNotifyChannels}
      )
      RETURNING *
    `
    
    // Log task creation in history
    await sql`
      INSERT INTO task_history (task_id, user_id, action, new_value)
      VALUES (${task[0].id}, ${user.id}, 'CREATED', ${JSON.stringify({ title, assignedToUserId, assignedToChildId })}::jsonb)
    `
    
    // Create notification for assigned user
    if (assignedToUserId && assignedToUserId !== user.id) {
      const assignerName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Someone'
      await notifyTaskAssigned(assignedToUserId, title, task[0].id, familyId, assignerName, normalizedNotifyChannels || undefined)
    }

    // Also notify parents if task is assigned to a child
    if (assignedToChildId) {
      const parents = await sql`
        SELECT fm.user_id
        FROM family_members fm
        WHERE fm.family_id = ${familyId}
          AND fm.is_active = true
          AND fm.role IN ('PARENT', 'GUARDIAN')
          AND fm.user_id != ${user.id}
      `
      const assignerName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Someone'
      for (const parent of parents) {
        await notifyTaskAssigned(parent.user_id, title, task[0].id, familyId, assignerName, normalizedNotifyChannels || undefined)
      }
    }
    
    return NextResponse.json({ data: task[0] }, { status: 201 })
  } catch (error) {
    console.error('Tasks POST error:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
