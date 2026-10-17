import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { getUserFromRequest, logAuditEvent } from '@/lib/auth'
import { ensureMemberAppearanceColumns } from '@/lib/member-appearance'
import { ensureAgeColumns } from '@/lib/age-schema'
import { ageFromDob, dobError, childAgeInfo } from '@/lib/age'

const updateChildSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  age: z.number().int().min(0).max(25).optional().nullable(),
  // YYYY-MM-DD, or null to clear. When sent, it wins over `age`.
  dateOfBirth: z.string().optional().nullable(),
  school: z.string().max(200).optional().nullable(),
  grade: z.string().max(50).optional().nullable(),
  emergencyNotes: z.string().max(1000).optional().nullable(),
})

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
    await ensureAgeColumns()

    // Get child profile with family info
    const childResult = await sql`
      SELECT
        cp.id,
        cp.display_name,
        cp.avatar_url,
        cp.grade,
        cp.school,
        cp.age,
        to_char(cp.date_of_birth, 'YYYY-MM-DD') AS dob,
        cp.adult_prompt_snoozed_until,
        cp.emergency_notes,
        fm.id as family_member_id,
        fm.user_id as member_user_id,
        fm.role as member_role,
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

    // A child's school, grade and emergency notes are for parents/guardians and
    // the child themself - not for other children in the family.
    const isAdult = membership[0].role === 'PARENT' || membership[0].role === 'GUARDIAN'
    const isThatChild = child.member_user_id === user.id
    if (!isAdult && !isThatChild) {
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
          // dateOfBirth, age (derived from the birthdate when known),
          // canHaveAccount, turns18On, daysUntil18, needsRoleChoice
          ...childAgeInfo({ dob: child.dob, age: child.age, role: child.member_role, userId: child.member_user_id, snoozedUntil: child.adult_prompt_snoozed_until }),
          hasLogin: !!child.member_user_id,
          hasAccount: !!child.member_user_id,
          canEdit: membership[0].role === 'PARENT',
          // Emergency notes stay with parents, guardians and the child themself.
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

// PATCH - Edit a child's details (parents only, same as adding a child)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ childId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { childId } = await params
    await ensureAgeColumns()

    const rows = await sql`
      SELECT cp.id, fm.family_id
      FROM child_profiles cp JOIN family_members fm ON cp.family_member_id = fm.id
      WHERE cp.id = ${childId}
    `
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Child not found' }, { status: 404 })
    }
    const familyId = rows[0].family_id as string

    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `
    if (membership.length === 0 || membership[0].role !== 'PARENT') {
      return NextResponse.json({ error: 'Only parents can edit a child\'s details' }, { status: 403 })
    }

    const data = updateChildSchema.parse(await request.json())

    // A birthdate wins over a plain age; the stored age is derived from it.
    // dateOfBirth: undefined = leave as is, null = clear it.
    const dobProvided = data.dateOfBirth !== undefined
    const dob = data.dateOfBirth || null
    if (dob) {
      const bad = dobError(dob)
      if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    }
    const ageProvided = dob !== null || data.age !== undefined
    const newAge = dob ? ageFromDob(dob) : data.age ?? null

    await sql`
      UPDATE child_profiles SET
        display_name = COALESCE(${data.displayName ?? null}, display_name),
        date_of_birth = CASE WHEN ${dobProvided} THEN ${dob}::date ELSE date_of_birth END,
        age = CASE WHEN ${ageProvided} THEN ${newAge}::int ELSE age END,
        school = CASE WHEN ${data.school !== undefined} THEN ${data.school ?? null} ELSE school END,
        grade = CASE WHEN ${data.grade !== undefined} THEN ${data.grade ?? null} ELSE grade END,
        emergency_notes = CASE WHEN ${data.emergencyNotes !== undefined} THEN ${data.emergencyNotes ?? null} ELSE emergency_notes END,
        updated_at = NOW()
      WHERE id = ${childId}
    `

    await logAuditEvent(user.id, 'UPDATE', 'child_profile', childId, {
      newValue: { ...data, familyId },
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error('Child profile update error:', error)
    return NextResponse.json({ error: 'Failed to update child' }, { status: 500 })
  }
}
