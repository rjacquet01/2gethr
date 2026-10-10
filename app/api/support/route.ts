import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest, checkFamilySubscription } from '@/lib/auth'
import { getTierDefinition } from '@/lib/subscription-tiers'
import { nanoid } from 'nanoid'
import { notifyAdmin, EMAIL_TEMPLATES } from '@/lib/services/email'

// GET - List user's support tickets
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tickets = await sql`
      SELECT 
        t.*,
        (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id) as message_count,
        (SELECT COUNT(*) FROM support_ticket_messages 
         WHERE ticket_id = t.id 
         AND sender_type = 'ADMIN' 
         AND created_at > COALESCE(
           (SELECT MAX(created_at) FROM support_ticket_messages 
            WHERE ticket_id = t.id AND sender_type = 'USER'),
           t.created_at
         )
        ) as unread_replies
      FROM support_tickets t
      WHERE t.user_id = ${user.id}
      ORDER BY t.updated_at DESC
    `

    return NextResponse.json({ data: tickets })
  } catch (error) {
    console.error('Support tickets GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
  }
}

// POST - Create a new support ticket
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { subject, description, category, priority = 'MEDIUM', familyId } = body

    if (!subject || !description || !category) {
      return NextResponse.json({ error: 'Subject, description, and category are required' }, { status: 400 })
    }

    // The support_tickets.priority column has a CHECK constraint allowing
    // only LOW/NORMAL/HIGH/URGENT, but the "new ticket" form (and this
    // route's own default) sends "MEDIUM" — every ticket submission at the
    // default priority was failing with a 500 (NeonDbError: violates check
    // constraint "support_tickets_priority_check"). Normalize here so any
    // caller using either convention still resolves to an allowed value.
    const PRIORITY_ALIASES: Record<string, string> = { MEDIUM: 'NORMAL' }
    const ALLOWED_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
    const requestedPriority = String(priority).toUpperCase()
    const normalizedPriority =
      PRIORITY_ALIASES[requestedPriority] ??
      (ALLOWED_PRIORITIES.includes(requestedPriority) ? requestedPriority : 'NORMAL')

    // Priority support: Basic and Premium families get their tickets bumped to HIGH.
    let finalPriority = normalizedPriority
    if (familyId && (finalPriority === 'NORMAL' || finalPriority === 'LOW')) {
      try {
        const sub = await checkFamilySubscription(String(familyId))
        if (getTierDefinition(sub.tier).features.prioritySupport) finalPriority = 'HIGH'
      } catch {}
    }

    // Generate ticket number
    const ticketNumber = `TKT-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`

    const ticket = await sql`
      INSERT INTO support_tickets (
        id, ticket_number, user_id, family_id, subject, description, 
        category, priority, status, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${ticketNumber}, ${user.id}, ${familyId || null}, 
        ${subject}, ${description}, ${category.toUpperCase()},
        ${finalPriority}, 'OPEN', NOW(), NOW()
      )
      RETURNING *
    `

    // Add initial message as the description (sender_id is NULL for user messages since user.id is text not uuid)
    await sql`
      INSERT INTO support_ticket_messages (
        id, ticket_id, sender_type, message, is_internal_note, created_at
      ) VALUES (
        gen_random_uuid(), ${ticket[0].id}, 'USER', ${description}, false, NOW()
      )
    `

    // Notify admin of the new ticket. Awaited so it can't be cut off by the
    // serverless runtime returning before it completes; notifyAdmin() never
    // throws, so a failed/slow email can't fail ticket creation itself.
    const ticketNotice = EMAIL_TEMPLATES.ADMIN_NEW_TICKET(
      ticket[0].ticket_number,
      user.email,
      subject,
      description
    )
    await notifyAdmin(ticketNotice.subject, ticketNotice.html, ticketNotice.text)

    return NextResponse.json({ data: ticket[0] }, { status: 201 })
  } catch (error) {
    console.error('Support ticket POST error:', error)
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
  }
}
