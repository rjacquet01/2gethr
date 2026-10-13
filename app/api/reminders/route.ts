import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import type { NotificationChannel } from '@/lib/notifications'
import { ensureReminderChildColumn } from '@/lib/reminder-schema'

const VALID_NOTIFY_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email', 'sms']

// GET - List the current user's standalone reminders.
// These are personal reminders ("pick up dry cleaning", "take medication") -
// not tied to a task or calendar event. Returns reminders the signed-in
// user owns (user_id) AND reminders they created for someone else
// (created_by_id) - so a reminder assigned to a family member stays
// visible/editable by whoever set it, not just its owner.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await ensureReminderChildColumn()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')?.toUpperCase()
    const familyId = searchParams.get('familyId')

    // Restrict to families the user actually belongs to (same guard as
    // /api/tasks) so a client-supplied familyId can't be used to read
    // another family's reminders.
    const memberships = await sql`
      SELECT family_id FROM family_members
      WHERE user_id = ${user.id} AND is_active = true
    `
    const myFamilyIds = memberships.map((m: { family_id: string }) => m.family_id)
    if (familyId && !myFamilyIds.includes(familyId)) {
      return NextResponse.json({ error: 'Family not found or access denied' }, { status: 403 })
    }

    const normalizedStatus = status && status !== 'ALL' ? status : null

    // What counts as "the archive" for a reminder: unlike tasks (which stay
    // visible with a COMPLETED/CANCELLED status until a separate bulk
    // "archive" step runs) a reminder has no such second step in the UI -
    // completing or dismissing one from the reminders page IS the end of
    // its active life. So ?status=ARCHIVED here means "everything no
    // longer active" (COMPLETED, DISMISSED, or the literal ARCHIVED
    // status, which PATCH .../reminders/[id] can still also set directly),
    // matching what the Archive page's Tasks/Events sections mean by
    // "archived" - history, not clutter in the main list. No status at all
    // (the reminders page's own fetch) means just PENDING, which is also
    // what fixes a real bug: previously this route's default excluded only
    // ARCHIVED, so a reminder a user had just completed or dismissed -
    // removed from the list purely client-side - silently reappeared on
    // the next page load because the server still considered it current.
    const statusFilter =
      normalizedStatus === 'ARCHIVED'
        ? ['COMPLETED', 'DISMISSED', 'ARCHIVED']
        : normalizedStatus
          ? [normalizedStatus]
          : ['PENDING']

    // Previously this built the two optional filters as nested sql``
    // fragments (`${familyId ? sql\`AND ...\` : sql\`\`}`), which the Neon
    // serverless driver's tagged-template composition mishandles once more
    // than one fragment in the same query can be genuinely empty - it
    // doesn't throw where the bug is introduced, just emits a query with a
    // stray "$3" placeholder, so every call died later with an opaque
    // "NeonDbError: syntax error at or near "$3"" (visible in Vercel logs
    // for basically every GET to this route, with or without ?status=).
    // That's the actual reason a newly created reminder never reappeared -
    // the list view's fetch silently 500'd and was swallowed by the
    // catch block below, leaving whatever was already in client state.
    // The standard "$param IS NULL OR column = $param" form below always
    // binds a real parameter instead of conditionally splicing in SQL text,
    // so there's no empty-fragment composition for the driver to get wrong.
    // statusFilter is computed above in JS (never conditionally spliced
    // SQL), and r.status = ANY(...) against it needs no "IS NULL OR" at
    // all, so the same bug class doesn't apply there either.
    const reminders = await sql`
      SELECT r.*,
             u_creator.first_name as creator_first_name, u_creator.last_name as creator_last_name,
             u_owner.first_name as owner_first_name, u_owner.last_name as owner_last_name,
             u_owner.id as owner_id,
             f.name as family_name,
             cp.display_name as child_name
      FROM reminders r
      LEFT JOIN users u_creator ON r.created_by_id = u_creator.id
      LEFT JOIN users u_owner ON r.user_id = u_owner.id
      LEFT JOIN families f ON r.family_id = f.id
      LEFT JOIN child_profiles cp ON r.child_profile_id = cp.id
      WHERE (r.user_id = ${user.id} OR r.created_by_id = ${user.id})
        AND r.status = ANY(${statusFilter})
        AND (${familyId || null}::text IS NULL OR r.family_id = ${familyId || null})
      ORDER BY r.remind_at ASC
    `

    return NextResponse.json({ data: reminders })
  } catch (error) {
    console.error('Reminders GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 })
  }
}

// POST - Create a new standalone reminder
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      familyId,
      forUserId,
      forMemberId,
      title,
      description,
      remindAt,
      isRecurring = false,
      recurrenceRule,
      notifyChannels,
    } = body

    if (!title || !remindAt) {
      return NextResponse.json({ error: 'Title and remindAt are required' }, { status: 400 })
    }

    const remindAtDate = new Date(remindAt)
    if (Number.isNaN(remindAtDate.getTime())) {
      return NextResponse.json({ error: 'remindAt must be a valid date/time' }, { status: 400 })
    }

    const resolvedFamilyId = familyId || user.primaryFamily?.id
    if (!resolvedFamilyId) {
      return NextResponse.json({ error: 'No family to attach this reminder to' }, { status: 400 })
    }

    // Verify the creator belongs to that family
    const membership = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${resolvedFamilyId} AND user_id = ${user.id} AND is_active = true
    `
    if (membership.length === 0) {
      return NextResponse.json({ error: 'Not a member of this family' }, { status: 403 })
    }

    // A reminder can be set for someone else in the family (e.g. a parent
    // reminding a child), defaulting to the creator themselves.
    await ensureReminderChildColumn()
    const creatorIsAdult = membership[0].role === 'PARENT' || membership[0].role === 'GUARDIAN'
    let ownerId: string = user.id
    let childProfileId: string | null = null
    const wantsOther = !!forMemberId || (!!forUserId && forUserId !== user.id)
    if (wantsOther) {
      const targetRows = forMemberId
        ? await sql`
            SELECT id, user_id, role FROM family_members
            WHERE id = ${forMemberId} AND family_id = ${resolvedFamilyId} AND is_active = true
          `
        : await sql`
            SELECT id, user_id, role FROM family_members
            WHERE user_id = ${forUserId} AND family_id = ${resolvedFamilyId} AND is_active = true
          `
      if (targetRows.length === 0) {
        return NextResponse.json({ error: 'That person is not in this family' }, { status: 400 })
      }
      const target = targetRows[0]
      const profile = await sql`
        SELECT id FROM child_profiles WHERE family_member_id = ${target.id} LIMIT 1
      `
      if (profile.length > 0 || target.role === 'CHILD') {
        if (!creatorIsAdult) {
          return NextResponse.json(
            { error: 'Only parents and guardians can set reminders for children' },
            { status: 403 }
          )
        }
        childProfileId = profile[0]?.id ?? null
      }
      // A child without their own login has no user_id: the reminder is
      // delivered to the parent who created it, labeled with the child's name.
      ownerId = target.user_id || user.id
    }

    const normalizedNotifyChannels: NotificationChannel[] | null =
      Array.isArray(notifyChannels) && notifyChannels.length > 0
        ? notifyChannels.filter((c: unknown): c is NotificationChannel =>
            typeof c === 'string' && (VALID_NOTIFY_CHANNELS as string[]).includes(c)
          )
        : null

    const reminder = await sql`
      INSERT INTO reminders (
        family_id, user_id, created_by_id, title, description, remind_at,
        is_recurring, recurrence_rule, status, notify_channels, child_profile_id
      ) VALUES (
        ${resolvedFamilyId}, ${ownerId}, ${user.id}, ${title}, ${description || null},
        ${remindAtDate.toISOString()}, ${isRecurring}, ${isRecurring ? recurrenceRule : null},
        'PENDING', ${normalizedNotifyChannels}, ${childProfileId}
      )
      RETURNING *
    `

    return NextResponse.json({ data: reminder[0] }, { status: 201 })
  } catch (error) {
    console.error('Reminders POST error:', error)
    return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 })
  }
}
