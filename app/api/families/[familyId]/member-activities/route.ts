import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

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

    await ensureMemberAppearanceColumns()

    // Get all family members with their tasks and upcoming events
    const members = await sql`
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
          WHEN 'CHILD' THEN 3 
          ELSE 4 
        END,
        fm.created_at
    `

    // Get child profiles
    const children = await sql`
      SELECT 
        cp.id as child_id,
        cp.display_name,
        cp.avatar_url,
        cp.family_member_id, fm.color, fm.emoji
      FROM child_profiles cp
      JOIN family_members fm ON cp.family_member_id = fm.id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true
    `

    // Get tasks for all members (assigned tasks and child tasks)
    const tasks = await sql`
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
      AND t.status NOT IN ('COMPLETED', 'CANCELLED')
      ORDER BY t.due_date ASC NULLS LAST, t.priority DESC
    `

    // Get upcoming events (next 7 days) with participants
    const upcomingEvents = await sql`
      SELECT 
        e.id,
        e.title,
        e.start_time,
        e.end_time,
        e.is_all_day,
        e.location,
        e.color,
        ep.user_id as participant_user_id
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      LEFT JOIN event_participants ep ON e.id = ep.event_id
      WHERE c.family_id = ${familyId}
      AND e.start_time >= NOW()
      AND e.start_time <= NOW() + INTERVAL '7 days'
      AND e.status != 'CANCELLED'
      ORDER BY e.start_time ASC
    `

    // Build member activity map
    const memberActivities = members.map((member: {
      member_id: string
      user_id: string
      role: string
      first_name: string
      last_name: string
      avatar_url: string
      display_name: string
    }) => {
      // Get tasks assigned to this user
      const memberTasks = tasks.filter((t: { assigned_to_id: string }) => 
        t.assigned_to_id === member.user_id
      )

      // Get events this user is participating in
      const memberEvents = upcomingEvents.filter((e: { participant_user_id: string }) => 
        e.participant_user_id === member.user_id
      )

      // Find child profile if this member has one
      const childProfile = children.find((c: { family_member_id: string }) => 
        c.family_member_id === member.member_id
      )

      // Get tasks assigned to child profile
      const childTasks = childProfile 
        ? tasks.filter((t: { child_profile_id: string }) => t.child_profile_id === childProfile.child_id)
        : []

      return {
        memberId: member.member_id,
        userId: member.user_id,
        displayName: member.display_name || `${member.first_name} ${member.last_name}`,
        avatarUrl: member.avatar_url,
        color: member.color || null,
        emoji: member.emoji || null,
        role: member.role,
        childProfileId: childProfile?.child_id || null,
        tasks: [...memberTasks, ...childTasks].slice(0, 5), // Limit to 5 tasks
        events: memberEvents.slice(0, 5), // Limit to 5 events
        taskCount: memberTasks.length + childTasks.length,
        eventCount: memberEvents.length,
      }
    })

    // Also add standalone child profiles (those without linked users)
    const standaloneChildren = children.filter((child: { family_member_id: string }) => {
      const linkedMember = members.find((m: { member_id: string }) => m.member_id === child.family_member_id)
      return !linkedMember?.user_id
    })

    standaloneChildren.forEach((child: {
      child_id: string
      display_name: string
      avatar_url: string
      family_member_id: string
      color?: string
      emoji?: string
    }) => {
      const childTasks = tasks.filter((t: { child_profile_id: string }) => t.child_profile_id === child.child_id)
      
      memberActivities.push({
        memberId: child.family_member_id,
        userId: null,
        displayName: child.display_name,
        avatarUrl: child.avatar_url,
        color: (child as { color?: string }).color || null,
        emoji: (child as { emoji?: string }).emoji || null,
        role: 'CHILD',
        childProfileId: child.child_id,
        tasks: childTasks.slice(0, 5),
        events: [],
        taskCount: childTasks.length,
        eventCount: 0,
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
