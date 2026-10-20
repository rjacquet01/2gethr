import { ensureEventParticipantChildColumns } from '@/lib/assignment'
import { NextRequest, NextResponse } from 'next/server'
import { sql, type Row } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { guestForbidden } from '@/lib/permissions'
import { ensureMemberAppearanceColumns } from '@/lib/member-appearance'
import { ensureReminderChildColumn } from '@/lib/reminder-schema'

// GET - Get tasks and events for each family member
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { familyId } = await params

    // Verify user is a member of this family
    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json({ error: 'Not a member of this family' }, { status: 403 })
    }
    if (membership[0].role === 'GUEST') return guestForbidden()

    await ensureMemberAppearanceColumns()
    await ensureReminderChildColumn()
    const viewerIsAdult = membership[0].role === 'PARENT' || membership[0].role === 'GUARDIAN'

    // Get all family members with their tasks and upcoming events
    const members = (await sql`
      SELECT 
        fm.id as member_id,
        fm.user_id,
        fm.role, fm.color, fm.emoji,
        u.first_name,
        u.last_name,
        u.profile_photo_url as avatar_url,
        COALESCE(u.first_name || ' ' || u.last_name, fm.nickname) as display_name
      FROM family_members fm
      LEFT JOIN users u ON fm.user_id = u.id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true
      ORDER BY 
        CASE fm.role 
          WHEN 'PARENT' THEN 1 
          WHEN 'GUARDIAN' THEN 2
          WHEN 'ADULT' THEN 3
          WHEN 'CHILD' THEN 4
          ELSE 5
        END,
        fm.created_at
    `) as Row<{ member_id: string; user_id: string | null; role: string; color: string | null; emoji: string | null; first_name: string | null; last_name: string | null; avatar_url: string | null; display_name: string | null }>[]

    // Get child profiles
    const children = (await sql`
      SELECT 
        cp.id as child_id,
        cp.display_name,
        cp.avatar_url,
        cp.family_member_id, fm.color, fm.emoji
      FROM child_profiles cp
      JOIN family_members fm ON cp.family_member_id = fm.id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true AND fm.role = 'CHILD'
    `) as Row<{ child_id: string; display_name: string; avatar_url: string | null; family_member_id: string; color: string | null; emoji: string | null }>[]

    // Get tasks for all members (assigned tasks and child tasks)
    const tasks = (await sql`
      SELECT 
        t.id,
        t.title,
        t.status,
        t.priority,
        t.due_date,
        t.due_time,
        t.assigned_to_id,
        t.child_profile_id,
        t.category
      FROM tasks t
      WHERE t.family_id = ${familyId}
      -- Open tasks only: archived/approved ones were counted as open before.
      AND UPPER(t.status) NOT IN ('COMPLETED', 'APPROVED', 'CANCELLED', 'ARCHIVED')
      ORDER BY t.due_date ASC NULLS LAST, t.priority DESC
    `) as Row<{ id: string; assigned_to_id: string | null; child_profile_id: string | null }>[]

    // Get upcoming events (next 7 days) with participants
    await ensureEventParticipantChildColumns()
    const upcomingEvents = (await sql`
      SELECT 
        e.id,
        e.title,
        e.start_time,
        e.end_time,
        e.is_all_day,
        e.location,
        e.color,
        ep.user_id as participant_user_id,
        ep.child_profile_id as participant_child_id
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      LEFT JOIN event_participants ep ON e.id = ep.event_id
      WHERE c.family_id = ${familyId}
      AND e.start_time >= NOW()
      AND e.start_time <= NOW() + INTERVAL '7 days'
      AND e.status != 'CANCELLED'
      -- PRIVATE / SELECTED_MEMBERS events only for their creator and participants
      AND (e.visibility IS NULL OR e.visibility = 'FAMILY' OR e.created_by_id = ${user.id}
           OR (e.visibility = 'SELECTED_MEMBERS' AND EXISTS (
                 SELECT 1 FROM event_participants me WHERE me.event_id = e.id AND me.user_id = ${user.id})))
      ORDER BY e.start_time ASC
    `) as Row<{ id: string; participant_user_id: string | null; participant_child_id: string | null }>[]

    // Pending reminders. Privacy: a reminder set for a child is visible to
    // parents/guardians (and the child's own login); anyone else's personal
    // reminder is visible only to the person it's for and whoever created it.
    const reminderRows = (await sql`
      SELECT id, title, remind_at, user_id, created_by_id, child_profile_id,
             notify_channels, is_recurring, recurrence_rule
      FROM reminders
      WHERE family_id = ${familyId} AND status = 'PENDING'
      ORDER BY remind_at ASC
    `) as Row<{ user_id: string; created_by_id: string; child_profile_id: string | null }>[]
    type ReminderRow = { user_id: string; created_by_id: string; child_profile_id: string | null }
    const visibleReminders = reminderRows.filter((r: ReminderRow) =>
      r.child_profile_id
        ? viewerIsAdult || r.user_id === user.id
        : r.user_id === user.id || r.created_by_id === user.id
    )

    // Build member activity map
    const memberActivities = members.map((member) => {
      // Get tasks assigned to this user
      const memberTasks = tasks.filter((t) =>
        t.assigned_to_id === member.user_id
      )

      // Get events this user is participating in
      const memberEvents = upcomingEvents.filter((e) =>
        e.participant_user_id === member.user_id
      )

      // Find child profile if this member has one
      const childProfile = children.find((c) =>
        c.family_member_id === member.member_id
      )

      // Get tasks assigned to child profile
      const childTasks = childProfile 
        ? tasks.filter((t) => t.child_profile_id === childProfile.child_id)
        : []

      const memberReminders = visibleReminders.filter((r: ReminderRow) =>
        r.child_profile_id
          ? !!childProfile && r.child_profile_id === childProfile.child_id
          : !!member.user_id && r.user_id === member.user_id
      )

      return {
        memberId: member.member_id,
        userId: member.user_id,
        hasAccount: !!member.user_id,
        displayName: member.display_name || childProfile?.display_name || `${member.first_name} ${member.last_name}`,
        avatarUrl: member.avatar_url || childProfile?.avatar_url || null,
        color: member.color || null,
        emoji: member.emoji || null,
        role: member.role,
        childProfileId: childProfile?.child_id || null,
        tasks: [...memberTasks, ...childTasks].slice(0, 5), // Limit to 5 tasks
        events: memberEvents.slice(0, 5), // Limit to 5 events
        taskCount: memberTasks.length + childTasks.length,
        eventCount: memberEvents.length,
        reminders: memberReminders.slice(0, 5),
        reminderCount: memberReminders.length,
      }
    })

    // Also add standalone child profiles (those without linked users)
    const standaloneChildren = children.filter((child) => {
      const linkedMember = members.find((m) => m.member_id === child.family_member_id)
      return !linkedMember?.user_id && !memberActivities.some((a) => a.memberId === child.family_member_id)
    })

    standaloneChildren.forEach((child) => {
      const childTasks = tasks.filter((t) => t.child_profile_id === child.child_id)
      const childReminders = visibleReminders.filter((r: ReminderRow) => r.child_profile_id === child.child_id)
      const seenEvents = new Set<string>()
      const childEvents = upcomingEvents.filter((e) => {
        if (e.participant_child_id !== child.child_id || seenEvents.has(e.id)) return false
        seenEvents.add(e.id)
        return true
      })
      
      memberActivities.push({
        memberId: child.family_member_id,
        userId: null,
        hasAccount: false,
        displayName: child.display_name,
        avatarUrl: child.avatar_url,
        color: (child as { color?: string }).color || null,
        emoji: (child as { emoji?: string }).emoji || null,
        role: 'CHILD',
        childProfileId: child.child_id,
        tasks: childTasks.slice(0, 5),
        events: childEvents.slice(0, 5),
        taskCount: childTasks.length,
        eventCount: childEvents.length,
        reminders: childReminders.slice(0, 5),
        reminderCount: childReminders.length,
      })
    })

    return NextResponse.json({ data: memberActivities })
  } catch (error) {
    console.error('Member activities fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch member activities' },
      { status: 500 }
    )
  }
}
