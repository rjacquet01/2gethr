import { NextRequest, NextResponse } from "next/server"
import { getAdminFromRequest } from "@/lib/admin-auth"
import { cronHealth } from "@/lib/cron-health"
import { databaseCheck, serviceChecks } from "@/lib/system-health"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { admin, error } = await getAdminFromRequest(request)
  if (!admin) {
    return NextResponse.json({ error: error || "Unauthorized" }, { status: 401 })
  }

  const database = await databaseCheck()
  let jobs: Awaited<ReturnType<typeof cronHealth>> = []
  let jobsError: string | null = null
  if (database.ok) {
    try {
      jobs = await cronHealth()
    } catch (e) {
      jobsError = e instanceof Error ? e.message : "Could not read job runs"
    }
  }

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      database,
      services: serviceChecks(process.env),
      deployment: {
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
        region: process.env.VERCEL_REGION || null,
      },
      jobs,
      jobsError,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
