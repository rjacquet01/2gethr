import { NextRequest, NextResponse } from 'next/server'
import { sql, type Row } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { createNotification, type NotificationChannel } from '@/lib/notifications'
import { getHistoryDays } from '@/lib/history-limit'
import { ensureReminderChildColumn } from '@/lib/reminder-schema'
import { getParentUserIds } from '@/lib/assignment'
import { memberName, actorNameInFamily } from "@/lib/member-names"

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
    const memberships = (await sql`
      SELECT family_id, role FROM family_members
      WHERE user_id = ${user.id} AND is_active = true
    `) as Row<{ family_id: string; role: string }>[]
    const myFamilyIds = memberships.map((m: { family_id: string }) => m.family_id)
    // Families where this person can approve a kid's "Ask a parent" reminder.
    const supervisedFamilyIds = memberships
      .filter((m: { role: string }) => m.role === 'PARENT' || m.role === 'GUARDIAN')
      .map((m: { family_id: string }) => m.family_id)
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
    const reminderRows = (await sql`
      SELECT r.*,
             u_creator.first_name as creator_first_name, u_creator.last_name as creator_last_name,
             u_owner.first_name as owner_first_name, u_owner.last_name as owner_last_name,
             u_owner.id as owner_id,
             fm_o.role as owner_role, fm_o.nickname as owner_nickname, cp_o.display_name as owner_child_name,
             f.name as family_name,
             cp.display_name as child_name
      FROM reminders r
      LEFT JOIN users u_creator ON r.created_by_id = u_creator.id
      LEFT JOIN users u_owner ON r.user_id = u_owner.id
      LEFT JOIN family_members fm_o ON fm_o.user_id = r.user_id AND fm_o.family_id = r.family_id AND fm_o.is_active = true
      LEFT JOIN child_profiles cp_o ON cp_o.family_member_id = fm_o.id
      LEFT JOIN families f ON r.family_id = f.id
      LEFT JOIN child_profiles cp ON r.child_profile_id = cp.id
      WHERE (r.user_id = ${user.id} OR r.created_by_id = ${user.id}
             OR (r.approval_status = 'PENDING_APPROVAL' AND r.family_id = ANY(${supervisedFamilyIds}::text[])))
        AND r.status = ANY(${statusFilter})
        AND (${familyId || null}::text IS NULL OR r.family_id = ${familyId || null})
      ORDER BY r.remind_at ASC
    `) as Row<{ family_id: string; updated_at: string }>[]
    // The owner as this family names them (lib/member-names.ts).
    const reminders = reminderRows.map((r) => ({
      ...r,
      owner_name: memberName({ role: r.owner_role as string, nickname: r.owner_nickname as string, childDisplayName: r.owner_child_name as string, firstName: r.owner_first_name as string, lastName: r.owner_last_name as string }, { withLastName: true, fallback: '' }),
    }))

    // The archive view only reaches back as far as the family's plan allows
    // (hidden, not deleted).
    if (normalizedStatus === 'ARCHIVED') {
      const limits = new Map<string, number>()
      for (const fid of new Set(reminders.map((x: { family_id: string }) => x.family_id))) {
        limits.set(fid as string, await getHistoryDays(fid as string))
      }
      const now = Date.now()
      return NextResponse.json({
        data: reminders.filter((x: { family_id: string; updated_at: string }) =>
          now - new Date(x.updated_at).getTime() <= (limits.get(x.family_id) || 30) * 86400000
        ),
      })
    }

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
      // A child chose "Ask a parent": the reminder waits for a parent's approval.
      askParent = false,
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
    // Setting reminders for children stays with parents/guardians (not ADULT).
    const creatorIsAdult = membership[0].role === 'PARENT' || membership[0].role === 'GUARDIAN'
    let ownerId: string = user.id
    let childProfileId: string | null = null
    const wantsOther = !!forMemberId || (!!forUserId && forUserId !== user.id)
    // Guests only see and create their own reminders.
    if (wantsOther && membership[0].role === 'GUEST') {
      return NextResponse.json({ error: 'Guests can only set reminders for themselves' }, { status: 403 })
    }
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

    // "Ask a parent" (children only): the reminder waits for a parent's
    // approval and doesn't fire until then. It's tied to the child's profile
    // so parents can see it and approve or decline it.
    const asksParent = membership[0].role === 'CHILD' && askParent === true
    if (asksParent && !childProfileId && ownerId === user.id) {
      const own = await sql`
        SELECT cp.id FROM child_profiles cp JOIN family_members fm ON fm.id = cp.family_member_id
        WHERE fm.user_id = ${user.id} AND fm.family_id = ${resolvedFamilyId} AND fm.is_active = true
        LIMIT 1
      `
      childProfileId = own[0]?.id ?? null
    }

    const reminder = await sql`
      INSERT INTO reminders (
        family_id, user_id, created_by_id, title, description, remind_at,
        is_recurring, recurrence_rule, status, notify_channels, child_profile_id, approval_status
      ) VALUES (
        ${resolvedFamilyId}, ${ownerId}, ${user.id}, ${title}, ${description || null},
        ${remindAtDate.toISOString()}, ${isRecurring}, ${isRecurring ? recurrenceRule : null},
        'PENDING', ${normalizedNotifyChannels}, ${childProfileId}, ${asksParent ? 'PENDING_APPROVAL' : null}
      )
      RETURNING *
    `

    if (asksParent) {
      const byName = await actorNameInFamily(resolvedFamilyId, user, 'Your child')
      for (const pid of await getParentUserIds(resolvedFamilyId, user.id)) {
        await createNotification({
          userId: pid, type: 'APPROVAL_REQUEST',
          title: 'Reminder needs your approval',
          body: `${byName} asked you to approve a reminder: "${title}". Open Reminders to approve or decline.`,
          data: { reminderId: reminder[0].id, familyId: resolvedFamilyId },
          sendEmail: true, sendSms: true, channels: normalizedNotifyChannels || undefined,
        }).catch((err) => console.error('Reminder approval request failed (non-fatal):', err))
      }
      return NextResponse.json({ data: reminder[0] }, { status: 201 })
    }

    // Tell the person a reminder was set FOR them right away (the cron only
    // delivers it at remind_at), on the channels the creator picked.
    if (ownerId !== user.id) {
      try {
        const tzRow = await sql`SELECT timezone FROM users WHERE id = ${ownerId}`
        const tz = tzRow[0]?.timezone || 'America/New_York'
        let when: string
        try {
          when = remindAtDate.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        } catch {
          when = remindAtDate.toISOString()
        }
        const byName = await actorNameInFamily(resolvedFamilyId, user, 'A family member')
        await createNotification({
          userId: ownerId,
          type: 'REMINDER',
          title: 'New reminder for you',
          body: `${byName} set a reminder for you: "${title}" (${when})`,
          data: { reminderId: reminder[0].id, familyId: resolvedFamilyId, kind: 'reminder_assigned' },
          sendEmail: true,
          sendSms: true,
          channels: normalizedNotifyChannels || undefined,
        })
      } catch (notifyErr) {
        console.error('Reminder-assigned notification failed (non-fatal):', notifyErr)
      }
    }

    return NextResponse.json({ data: reminder[0] }, { status: 201 })
  } catch (error) {
    console.error('Reminders POST error:', error)
    return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 })
  }
}
