import { NextRequest, NextResponse } from "next/server"
import { 
  checkAndNotifyOverdueTasks, 
  checkAndNotifyEventReminders,
  checkAndNotifyUpcomingDueDates 
} from "@/lib/notifications"

// This endpoint should be called by a cron job (e.g., Vercel Cron)
// Configure in vercel.json with schedule: "0 * * * *" (every hour)
// This processes:
// - Overdue tasks
// - Event reminders (short-term)
// - Tasks and events due in the next 48 hours

export async function GET(request: NextRequest) {
  try {
    // Verify the request is from Vercel Cron (optional security)
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret ? authHeader !== `Bearer ${cronSecret}` : process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Check for overdue tasks and notify
    const overdueResult = await checkAndNotifyOverdueTasks()
    
    // Check for upcoming event reminders (short-term, based on reminder_minutes)
    const reminderResult = await checkAndNotifyEventReminders()
    
    // Check for tasks and events due in the next 48 hours
    const upcoming48hResult = await checkAndNotifyUpcomingDueDates()

    console.log('[Cron] Notifications processed:', {
      overdueTasksNotified: overdueResult.notified,
      eventRemindersNotified: reminderResult.notified,
      upcoming48hTasks: upcoming48hResult.tasksNotified,
      upcoming48hEvents: upcoming48hResult.eventsNotified,
    })

    return NextResponse.json({
      success: true,
      data: {
        overdueTasksNotified: overdueResult.notified,
        eventRemindersNotified: reminderResult.notified,
        upcoming48hTasksNotified: upcoming48hResult.tasksNotified,
        upcoming48hEventsNotified: upcoming48hResult.eventsNotified,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Cron notifications error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to process notifications" },
      { status: 500 }
    )
  }
}

// Also allow POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request)
}
