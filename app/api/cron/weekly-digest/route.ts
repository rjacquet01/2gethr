import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { sendEmail, EMAIL_TEMPLATES } from "@/lib/services/email"

// Verify the request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true
  }
  // Also allow in development or if CRON_SECRET is not set
  if (!process.env.CRON_SECRET || process.env.NODE_ENV === 'development') {
    return true
  }
  return false
}

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("[Cron] Starting weekly digest job at", new Date().toISOString())

    // Get users eligible for weekly digest (active parents/guardians)
    const digestUsers = await sql`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        f.name as family_name,
        f.id as family_id,
        rs.weekly_digest
      FROM users u
      JOIN family_members fm ON u.id = fm.user_id
      JOIN families f ON fm.family_id = f.id
      LEFT JOIN reminder_settings rs ON u.id = rs.user_id
      WHERE u.is_active = true
      AND fm.is_active = true
      AND fm.role IN ('PARENT', 'GUARDIAN')
      AND (rs.weekly_digest = true OR rs.weekly_digest IS NULL)
    `

    console.log(`[Cron] Found ${digestUsers.length} eligible users for weekly digest`)

    const startOfWeek = new Date()
    const endOfWeek = new Date()
    endOfWeek.setDate(endOfWeek.getDate() + 7)

    const weekStartFormatted = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const weekEndFormatted = endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    const results = {
      total: digestUsers.length,
      sent: 0,
      failed: 0,
      skipped: 0,
    }

    for (const user of digestUsers) {
      try {
        // Get upcoming events for this user's family
        //
        // e.status is checked against the events.status Postgres enum,
        // whose only valid values are PENDING/APPROVED/REJECTED/CANCELLED/
        // ARCHIVED - there is no SCHEDULED. The previous 'SCHEDULED' literal
        // here made this query throw NeonDbError "invalid input value for
        // enum event_status" for every single user, every time this cron
        // ran, so it always landed in the catch block below, logged as a
        // failure, and never sent a real digest email on schedule (the
        // admin "Send Test Digest" button uses a separate endpoint that
        // already queries the correct 'APPROVED' value, which is why this
        // went unnoticed). APPROVED is the status normal, non-rejected,
        // non-cancelled events end up with - same fix already applied to
        // the event-reminder cron's 'CONFIRMED' typo.
        const familyEvents = await sql`
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

        // Get tasks summary for the past week
        const tasksSummary = await sql`
          SELECT
            COALESCE(COUNT(*) FILTER (WHERE status = 'COMPLETED'), 0)::int as completed,
            COALESCE(COUNT(*) FILTER (WHERE status = 'PENDING'), 0)::int as pending,
            COALESCE(COUNT(*) FILTER (WHERE status = 'OVERDUE' OR (status = 'PENDING' AND due_date < NOW())), 0)::int as overdue
          FROM tasks
          WHERE family_id = ${user.family_id}
          AND created_at >= NOW() - INTERVAL '7 days'
        `

        const tasks = tasksSummary[0] || { completed: 0, pending: 0, overdue: 0 }

        // Skip if no events and no tasks activity
        if (familyEvents.length === 0 && tasks.completed === 0 && tasks.pending === 0) {
          results.skipped++
          continue
        }

        // Generate email content
        const emailContent = EMAIL_TEMPLATES.WEEKLY_DIGEST(
          user.first_name || 'there',
          user.family_name,
          weekStartFormatted,
          weekEndFormatted,
          familyEvents,
          tasks
        )

        // Send email via Resend
        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        })

        // Create notification record
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
              tasks,
              generatedBy: 'cron',
              sentAt: new Date().toISOString()
            })},
            NOW(),
            NOW()
          )
        `

        results.sent++
        console.log(`[Cron] Sent weekly digest to ${user.email}`)

      } catch (userError) {
        console.error(`[Cron] Failed to send digest to ${user.email}:`, userError)
        results.failed++
      }
    }

    console.log(`[Cron] Weekly digest completed: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped`)

    // Log summary to admin_action_logs
    await sql`
      INSERT INTO admin_action_logs (
        id, admin_id, action, resource_type, resource_id, metadata, created_at
      ) VALUES (
        ${crypto.randomUUID()},
        NULL,
        'WEEKLY_DIGEST_CRON',
        'system',
        'weekly_digest',
        ${JSON.stringify({
          ...results,
          executedAt: new Date().toISOString(),
          triggeredBy: 'cron'
        })},
        NOW()
      )
    `

    return NextResponse.json({
      success: true,
      message: `Weekly digest cron completed`,
      results,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error("[Cron] Weekly digest error:", error)
    return NextResponse.json(
      { success: false, error: "Weekly digest cron failed" },
      { status: 500 }
    )
  }
}
