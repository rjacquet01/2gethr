import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { ensureMemberAppearanceColumns } from '@/lib/member-appearance'

// GET - Get child profile with tasks and events
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ childId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { childId } = await params
    await ensureMemberAppearanceColumns()

    // Get child profile with family info
    const childResult = await sql`
      SELECT 
        cp.id,
        cp.display_name,
        cp.avatar_url,
        cp.grade,
        cp.school,
        cp.age,
        cp.emergency_notes,
        fm.id as family_member_id,
        fm.color,
        fm.emoji,
        f.id as family_id,
        f.name as family_name
      FROM child_profiles cp
      JOIN family_members fm ON cp.family_member_id = fm.id
      JOIN families f ON fm.family_id = f.id
      WHERE cp.id = ${childId}
    `

    if (childResult.length === 0) {
      return NextResponse.json({ error: 'Child not found' }, { status: 404 })
    }

    const child = childResult[0]

    // Verify user is a member of this family
    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${child.family_id} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json({ error: 'Not authorized to view this child' }, { status: 403 })
    }

    // Get tasks assigned to this child
    const tasks = await sql`
      SELECT 
        id,
        title,
        status,
        priority,
        due_date,
        category
      FROM tasks
      WHERE child_profile_id = ${childId}
      AND status NOT IN ('COMPLETED', 'CANCELLED')
      ORDER BY due_date ASC NULLS LAST, priority DESC
      LIMIT 20
    `

    // Get upcoming events (next 7 days) for this family
    // Since event_participants doesn't have child_profile_id, 
    // we show family events that the child might be involved in
    const events = await sql`
      SELECT 
        e.id,
        e.title,
        e.start_time,
        e.end_time,
        e.is_all_day,
        e.location,
        e.color
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      WHERE c.family_id = ${child.family_id}
      AND e.start_time >= NOW()
      AND e.start_time <= NOW() + INTERVAL '7 days'
      AND e.status != 'CANCELLED'
      ORDER BY e.start_time ASC
      LIMIT 20
    `

    return NextResponse.json({
      data: {
        profile: {
          id: child.id,
          displayName: child.display_name,
          avatarUrl: child.avatar_url,
          grade: child.grade,
          school: child.school,
          age: child.age,
          emergencyNotes: child.emergency_notes,
          familyMemberId: child.family_member_id,
          color: child.color || null,
          emoji: child.emoji || null,
          familyId: child.family_id,
          familyName: child.family_name,
        },
        tasks,
        events,
      }
    })
  } catch (error) {
    console.error('Child profile fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch child profile' },
      { status: 500 }
    )
  }
}
