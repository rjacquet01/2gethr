import { NextResponse } from "next/server"
import { cronHealth } from "@/lib/cron-health"
import { databaseCheck } from "@/lib/system-health"

export const dynamic = "force-dynamic"

// Public uptime check: database reachable and scheduled jobs on time.
// No job names, settings or errors here; those are in the admin portal.
export async function GET() {
  const db = await databaseCheck()
  let jobs: "ok" | "attention" | "unknown" = "unknown"
  if (db.ok) {
    try {
      const states = (await cronHealth()).map((j) => j.state)
      jobs = states.some((s) => s === "late" || s === "failing") ? "attention" : "ok"
    } catch {}
  }
  return NextResponse.json(
    { status: db.ok ? "ok" : "down", database: db.ok ? "ok" : "down", jobs },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  )
}
