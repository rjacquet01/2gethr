import { NextRequest, NextResponse } from "next/server"
import { alertsDue, cronHealth, markAlerted, monitorCron, registerCronJobs } from "@/lib/cron-health"
import { notifyAdmin, EMAIL_TEMPLATES } from "@/lib/services/email"

// Every 15 minutes: emails the admin when a scheduled job is late or failing
// (once, then daily while it stays that way) and when it recovers.
async function runJob(request: NextRequest) {
  const authHeader = request.headers.get("Authorization")
  if (process.env.CRON_SECRET ? authHeader !== `Bearer ${process.env.CRON_SECRET}` : process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    await registerCronJobs()
    const now = new Date()
    const jobs = (await cronHealth(now)).filter((j) => j.name !== "cron-watch")
    const { bad, recovered } = alertsDue(jobs, now)
    if (bad.length || recovered.length) {
      const email = EMAIL_TEMPLATES.ADMIN_CRON_ALERT(bad, recovered.map((j) => j.name))
      await notifyAdmin(email.subject, email.html, email.text)
      await markAlerted(bad.map((j) => j.name), recovered.map((j) => j.name))
    }
    return NextResponse.json({
      success: true,
      jobs: jobs.length,
      attention: jobs.filter((j) => j.state === "late" || j.state === "failing").map((j) => j.name),
      alerted: bad.map((j) => j.name),
      recovered: recovered.map((j) => j.name),
    })
  } catch (error) {
    console.error("[cron-watch] failed:", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Cron watch failed" }, { status: 500 })
  }
}

export const GET = monitorCron("cron-watch", runJob)
