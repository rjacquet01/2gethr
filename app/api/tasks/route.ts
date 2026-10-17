import { createNotification } from '@/lib/notifications'
import { ensureAssignmentColumns, isSupervisorRole, needsParentToApprove, getParentUserIds } from '@/lib/assignment'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { ensureTaskEventNotifyChannelsColumns } from '@/lib/notify-channels-schema'
import { filterTasksForGuest } from '@/lib/guest-scope'
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

    // Guests only see tasks they created or are assigned to.
    const guestFamilyIds: string[] = memberships
      .filter((m) => m.role === 'GUEST')
      .map((m) => m.family_id as string)
    if (guestFamilyIds.length > 0) {
      tasks = await filterTasksForGuest(tasks, user.id, (t) => t.family_id, guestFamilyIds)
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
    await ensureAssignmentColumns()

    const creatorRole = membership[0].role as string
    // A guest doesn't pick other family members: their tasks are for themselves.
    if (creatorRole === 'GUEST' && ((assignedToUserId && assignedToUserId !== user.id) || assignedToChildId)) {
      return NextResponse.json({ error: 'Guests can only assign tasks to themselves' }, { status: 403 })
    }
    const assignerName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Someone'

    // Who is really being assigned? A child profile may have a login.
    let targetUserId: string | null = assignedToUserId || null
    let targetRole: string | null = null
    let targetName: string | null = null
    if (assignedToChildId) {
      const cp = await sql`
        SELECT fm.user_id, fm.role, cp.display_name
        FROM child_profiles cp JOIN family_members fm ON cp.family_member_id = fm.id
        WHERE cp.id = ${assignedToChildId}
      `
      if (cp[0]) { targetUserId = targetUserId || cp[0].user_id; targetRole = cp[0].role; targetName = cp[0].display_name }
    }
    if (targetUserId && !targetRole) {
      const r = await sql`
        SELECT role FROM family_members
        WHERE family_id = ${familyId} AND user_id = ${targetUserId} AND is_active = true LIMIT 1
      `
      targetRole = r[0]?.role || null
    }

    // Kid-created assignments: to a grown-up or a guest => a parent must approve;
    // to another kid => that kid must accept. Parents/self need neither.
    let assignmentStatus: string | null = null
    if (creatorRole === 'CHILD' && (assignedToUserId || assignedToChildId) && targetUserId !== user.id) {
      assignmentStatus = (!targetUserId || needsParentToApprove(targetRole)) ? 'PENDING_APPROVAL' : 'PENDING_ACCEPTANCE'
    }

    // Create the task
    const task = await sql`
      INSERT INTO tasks (
        family_id, title, description, created_by_id,
        assigned_to_id, child_profile_id, due_date,
        priority, category, status, is_recurring, recurrence_rule,
        notify_channels, assignment_status
      ) VALUES (
        ${familyId}, ${title}, ${description || null}, ${user.id},
        ${assignedToUserId || null}, ${assignedToChildId || null},
        ${dueDate || null},
        ${priority.toUpperCase()}, ${category || 'CHORE'}, 'PENDING',
        ${isRecurring}, ${isRecurring ? recurrenceRule : null},
        ${normalizedNotifyChannels}, ${assignmentStatus}
      )
      RETURNING *
    `

    // Log task creation in history
    await sql`
      INSERT INTO task_history (task_id, user_id, action, new_value)
      VALUES (${task[0].id}, ${user.id}, 'CREATED', ${JSON.stringify({ title, assignedToUserId, assignedToChildId, assignmentStatus })}::jsonb)
    `

    const ch = normalizedNotifyChannels || undefined
    if (assignmentStatus === 'PENDING_APPROVAL') {
      // Every parent/guardian can approve or decline.
      const who = targetName ? ` for ${targetName}` : ''
      for (const pid of await getParentUserIds(familyId, user.id)) {
        await createNotification({
          userId: pid, type: 'APPROVAL_REQUEST',
          title: 'Task needs your approval',
          body: `${assignerName} wants to assign a task${who}: "${title}". Open it to approve or decline.`,
          data: { taskId: task[0].id, familyId }, sendEmail: true, sendSms: true, channels: ch,
        })
      }
    } else if (assignmentStatus === 'PENDING_ACCEPTANCE' && targetUserId) {
      await createNotification({
        userId: targetUserId, type: 'APPROVAL_REQUEST',
        title: 'Task request',
        body: `${assignerName} wants to assign you a task: "${title}". Accept or decline.`,
        data: { taskId: task[0].id, familyId }, sendEmail: true, sendSms: true, channels: ch,
      })
    } else {
      // Normal assignment: tell the assignee (including a child profile that has a login).
      if (targetUserId && targetUserId !== user.id) {
        if (isSupervisorRole(creatorRole) && targetRole === 'CHILD') {
          // A parent gave a child a task: push + email + text + in-app, always.
          await createNotification({
            userId: targetUserId, type: 'TASK_ASSIGNED',
            title: 'New Task Assigned',
            body: `${assignerName} assigned you a task: "${title}"`,
            data: { taskId: task[0].id, familyId },
            channels: ['in_app', 'push', 'email', 'sms'], force: true,
          })
        } else {
          await notifyTaskAssigned(targetUserId, title, task[0].id, familyId, assignerName, ch)
        }
      }
      // Parents get an FYI when a child is assigned something.
      if (assignedToChildId) {
        for (const pid of await getParentUserIds(familyId, user.id)) {
          if (pid === targetUserId) continue
          await createNotification({
            userId: pid, type: 'TASK_ASSIGNED',
            title: 'Task assigned to ' + (targetName || 'a child'),
            body: `${assignerName} assigned ${targetName || 'a child'} a task: "${title}"`,
            data: { taskId: task[0].id, familyId }, channels: ch,
          })
        }
      }
    }

    return NextResponse.json({ data: task[0] }, { status: 201 })
  } catch (error) {
    console.error('Tasks POST error:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
