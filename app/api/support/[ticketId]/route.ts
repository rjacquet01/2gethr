import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

// GET - Get ticket details with messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ticketId } = await params

    // Validate ticketId is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(ticketId)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    }

    // Get ticket (only if owned by user)
    const ticket = await sql`
      SELECT t.*,
             f.name as family_name
      FROM support_tickets t
      LEFT JOIN families f ON t.family_id = f.id
      WHERE t.id = ${ticketId}::uuid AND t.user_id = ${user.id}
    `

    if (ticket.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Get messages (excluding internal notes)
    // For user messages, get user info from the ticket's user_id since sender_id may be null
    const ticketUser = await sql`SELECT * FROM users WHERE id = ${ticket[0].user_id}`
    const userName = ticketUser.length > 0 
      ? `${ticketUser[0].first_name} ${ticketUser[0].last_name || ''}`.trim() 
      : 'User'
    const userEmail = ticketUser.length > 0 ? ticketUser[0].email : null

    const messages = await sql`
      SELECT m.*,
             CASE 
               WHEN m.sender_type = 'USER' THEN ${userName}
               WHEN m.sender_type = 'ADMIN' THEN 'Support Team'
               ELSE 'System'
             END as sender_name,
             CASE 
               WHEN m.sender_type = 'USER' THEN ${userEmail}
               WHEN m.sender_type = 'ADMIN' THEN 'admin@mytogethr.com'
               ELSE NULL
             END as sender_email
      FROM support_ticket_messages m
      WHERE m.ticket_id = ${ticketId}::uuid AND m.is_internal_note = false
      ORDER BY m.created_at ASC
    `

    return NextResponse.json({ 
      ticket: ticket[0],
      messages 
    })
  } catch (error) {
    console.error('Support ticket detail GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch ticket' }, { status: 500 })
  }
}

// POST - Add a message to the ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { user } = await getUserFromRequest(request)
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ticketId } = await params
    const body = await request.json()
    const { message } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Verify ticket ownership
    const ticket = await sql`
      SELECT * FROM support_tickets 
      WHERE id = ${ticketId}::uuid AND user_id = ${user.id}
    `

    if (ticket.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Don't allow messages on closed tickets
    if (ticket[0].status === 'CLOSED') {
      return NextResponse.json({ error: 'Cannot add messages to closed tickets' }, { status: 400 })
    }

    // Add message (sender_id left NULL since user.id is text, not uuid - ticket.user_id links to user)
    const newMessage = await sql`
      INSERT INTO support_ticket_messages (
        id, ticket_id, sender_type, message, is_internal_note, created_at
      ) VALUES (
        gen_random_uuid(), ${ticketId}::uuid, 'USER', ${message}, false, NOW()
      )
      RETURNING *
    `

    // Update ticket status to OPEN if it was waiting for customer response
    if (ticket[0].status === 'WAITING_ON_CUSTOMER') {
      await sql`
        UPDATE support_tickets 
        SET status = 'OPEN', updated_at = NOW() 
        WHERE id = ${ticketId}::uuid
      `
    } else {
      await sql`
        UPDATE support_tickets SET updated_at = NOW() WHERE id = ${ticketId}::uuid
      `
    }

    return NextResponse.json({ data: newMessage[0] }, { status: 201 })
  } catch (error) {
    console.error('Support ticket message POST error:', error)
    return NextResponse.json({ error: 'Failed to add message' }, { status: 500 })
  }
}
