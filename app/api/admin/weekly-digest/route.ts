import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getAdminFromRequest, hasPermission, logAdminAction } from "@/lib/admin-auth"
import { sendEmail, EMAIL_TEMPLATES } from "@/lib/services/email"

// GET - Retrieves users eligible for weekly digest and preview stats
export async function GET(request: NextRequest) {
  try {
    const { admin, error } = await getAdminFromRequest(request)

    if (!admin) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 })
    }

    if (!hasPermission(admin, 'users.read')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    // Get count of users with weekly digest enabled
    const digestUsers = await sql`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.last_login_at,
        f.name as family_name,
        f.id as family_id,
        fm.role,
        rs.weekly_digest as digest_enabled
      FROM users u
      JOIN family_members fm ON u.id = fm.user_id
      JOIN families f ON fm.family_id = f.id
      LEFT JOIN reminder_settings rs ON u.id = rs.user_id
      WHERE u.is_active = true
      AND fm.is_active = true
      AND fm.role IN ('PARENT', 'GUARDIAN')
      AND (rs.weekly_digest = true OR rs.weekly_digest IS NULL)
      ORDER BY f.name, u.first_name
    `

    // Get last digest send info
    const lastDigest = await sql`
      SELECT * FROM admin_action_logs
      WHERE action = 'WEEKLY_DIGEST_SENT'
      ORDER BY created_at DESC
      LIMIT 1
    `

    // Get upcoming events for the week (to include in digest)
    const startOfWeek = new Date()
    const endOfWeek = new Date()
    endOfWeek.setDate(endOfWeek.getDate() + 7)

    const upcomingEvents = await sql`
      SELECT COUNT(DISTINCT e.id) as event_count
      FROM events e
      WHERE e.status = 'APPROVED'
      AND e.start_time >= ${startOfWeek.toISOString()}
      AND e.start_time <= ${endOfWeek.toISOString()}
    `

    return NextResponse.json({
      success: true,
      data: {
        eligibleUsers: digestUsers.length,
        users: digestUsers,
        lastSent: lastDigest[0]?.created_at || null,
        lastSentBy: lastDigest[0]?.metadata?.adminEmail || null,
        preview: {
          weekStart: startOfWeek.toISOString(),
          weekEnd: endOfWeek.toISOString(),
          upcomingEventsCount: Number(upcomingEvents[0]?.event_count || 0),
        }
      }
    })
  } catch (error) {
    console.error("Get weekly digest stats error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get digest stats" },
      { status: 500 }
    )
  }
}

// POST - Send weekly digest emails
// Restricted to SUPER_ADMIN since this mass-emails every parent/guardian.
export async function POST(request: NextRequest) {
  try {
    const { admin, error } = await getAdminFromRequest(request)

    if (!admin) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 })
    }

    if (!admin.roles.includes('SUPER_ADMIN')) {
      return NextResponse.json(
        { success: false, error: 'Only super admins can send the weekly digest' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { testMode = false, testEmail = null } = body

    // Get users with weekly digest enabled (parents/guardians only)
    const digestUsers = await sql`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        f.name as family_name,
        f.id as family_id
      FROM users u
      JOIN family_members fm ON u.id = fm.user_id
      JOIN families f ON fm.family_id = f.id
      WHERE u.is_active = true
      AND fm.is_active = true
      AND fm.role IN ('PARENT', 'GUARDIAN')
    `

    const startOfWeek = new Date()
    const endOfWeek = new Date()
    endOfWeek.setDate(endOfWeek.getDate() + 7)

    // Process each user's digest
    const results = {
      total: testMode ? 1 : digestUsers.length,
      sent: 0,
      failed: 0,
      details: [] as Array<{ email: string; status: string; events: number }>
    }

    // For test mode, create a test user object if the email isn't in the eligible list
    let usersToProcess: Array<{ id: string; email: string; first_name: string; last_name: string; family_name: string; family_id: string }>

    if (testMode && testEmail) {
      // Check if test email exists in eligible users
      const existingUser = digestUsers.find((u: { email: string }) => u.email === testEmail)
      if (existingUser) {
        usersToProcess = [existingUser]
      } else {
        // Use first family's data for test, or create mock data
        const sampleFamily = digestUsers.length > 0
          ? { family_id: digestUsers[0].family_id, family_name: digestUsers[0].family_name }
          : { family_id: null, family_name: 'Test Family' }

        usersToProcess = [{
          id: 'test-user',
          email: testEmail,
          first_name: 'Test',
          last_name: 'User',
          family_name: sampleFamily.family_name,
          family_id: sampleFamily.family_id
        }]
      }
    } else {
      usersToProcess = digestUsers
    }

    for (const user of usersToProcess) {
      try {
        let familyEvents: Array<{ id: string; title: string; start_time: string; end_time: string; location: string; is_all_day: boolean; calendar_name: string }> = []
        let tasksSummary = [{ completed: 0, pending: 0, overdue: 0 }]

        // Only query database if we have a valid family_id
        if (user.family_id) {
          // Get upcoming events for this user's family
          familyEvents = await sql`
            SELECT
              e.id, e.title, e.start_time, e.end_time, e.location,
              e.is_all_day, c.name as calendar_name
            FROM events e
            JOIN calendars c ON e.calendar_id = c.id
            WHERE c.family_id = ${user.family_id}
            AND e.status = 'APPROVED'
            AND e.start_time >= ${startOfWeek.toISOString()}
            AND e.start_time <= ${endOfWeek.toISOString()}
            ORDER BY e.start_time ASC
            LIMIT 20
          `

          // Get recent tasks summary
          tasksSummary = await sql`
            SELECT
              COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
              COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
              COUNT(*) FILTER (WHERE status = 'OVERDUE') as overdue
            FROM tasks
            WHERE family_id = ${user.family_id}
            AND created_at >= NOW() - INTERVAL '7 days'
          `
        } else {
          // Test mode with no family - use sample data
          familyEvents = [
            { id: 'test-1', title: 'Soccer Practice', start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 90000000).toISOString(), location: 'City Park', is_all_day: false, calendar_name: 'Sports' },
            { id: 'test-2', title: 'Family Dinner', start_time: new Date(Date.now() + 172800000).toISOString(), end_time: new Date(Date.now() + 176400000).toISOString(), location: 'Home', is_all_day: false, calendar_name: 'Family' },
          ]
          tasksSummary = [{ completed: 5, pending: 3, overdue: 1 }]
        }

        // Format dates for display
        const weekStartFormatted = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const weekEndFormatted = endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

        // Send email via Resend
        const emailContent = EMAIL_TEMPLATES.WEEKLY_DIGEST(
          user.first_name || 'there',
          user.family_name,
          weekStartFormatted,
          weekEndFormatted,
          familyEvents,
          tasksSummary[0] || { completed: 0, pending: 0, overdue: 0 }
        )

        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        })

        // Create notification record only for real users (not test mode with fake user)
        if (user.id !== 'test-user') {
          await sql`
            INSERT INTO notifications (
              id, user_id, type, title, body, data, created_at, sent_at
            ) VALUES (
              ${crypto.randomUUID()},
              ${user.id},
              'WEEKLY_DIGEST',
              ${'Weekly Family Summary - ' + user.family_name},
              ${`Your weekly digest is ready! You have ${familyEvents.length} upcoming events this week.`},
              ${JSON.stringify({
                weekStart: startOfWeek.toISOString(),
                weekEnd: endOfWeek.toISOString(),
                eventsCount: familyEvents.length,
                events: familyEvents.slice(0, 5),
                tasks: tasksSummary[0] || { completed: 0, pending: 0, overdue: 0 },
                generatedBy: 'admin',
                adminId: admin.id
              })},
              NOW(),
              NOW()
            )
          `
        }

        results.sent++
        results.details.push({
          email: user.email,
          status: 'sent',
          events: familyEvents.length
        })

      } catch (userError) {
        console.error(`Failed to process digest for ${user.email}:`, userError)
        results.failed++
        results.details.push({
          email: user.email,
          status: 'failed',
          events: 0
        })
      }
    }

    // Log the admin action
    await logAdminAction(
      admin.id,
      testMode ? 'WEEKLY_DIGEST_TEST' : 'WEEKLY_DIGEST_SENT',
      'system',
      'weekly_digest',
      {
        total: results.total,
        sent: results.sent,
        failed: results.failed,
        testMode,
        testEmail: testMode ? testEmail : null,
        adminEmail: admin.email
      },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    )

    return NextResponse.json({
      success: true,
      message: testMode
        ? `Test digest sent to ${testEmail}`
        : `Weekly digest sent to ${results.sent} users`,
      results
    })

  } catch (error) {
    console.error("Send weekly digest error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to send weekly digest" },
      { status: 500 }
    )
  }
}
