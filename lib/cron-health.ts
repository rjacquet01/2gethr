import type { NextRequest } from "next/server"
import { sql } from "./db"
import { ddl } from "./schema-snapshot"
import vercelConfig from "@/vercel.json"

// Every scheduled job records its last run (one row per job, never more), so
// a job that silently stops or keeps failing shows up in the admin health page
// and in an email from /api/cron/cron-watch. The job list comes from
// vercel.json, so a new cron is watched as soon as it is scheduled.

export interface CronJob {
  name: string
  path: string
  schedule: string
  intervalMin: number
}

// Minutes between runs for the schedules vercel.json uses: every N minutes,
// hourly, daily, or on given weekdays.
export function cronIntervalMinutes(schedule: string): number {
  const [min, hour, , , dow] = schedule.trim().split(/\s+/)
  if (min === "*") return 1
  const step = /^\*\/(\d+)$/.exec(min)
  if (step) return Number(step[1])
  if (hour === "*") return 60
  if (dow && dow !== "*") return 7 * 24 * 60
  return 24 * 60
}

export const CRON_JOBS: CronJob[] = vercelConfig.crons.map((c) => ({
  name: c.path.split("/").pop() as string,
  path: c.path,
  schedule: c.schedule,
  intervalMin: cronIntervalMinutes(c.schedule),
}))

// How long past its interval a job may go before it counts as late: Vercel
// can start a run a little late or skip one. 15 minutes for frequent jobs,
// up to 6 hours for daily and weekly ones.
export function lateAfterMinutes(intervalMin: number): number {
  return intervalMin + Math.max(15, Math.min(intervalMin / 4, 360))
}

export interface CronRunRow {
  job: string
  last_finished_at: string | Date | null
  last_ok_at: string | Date | null
  last_error_at: string | Date | null
  last_error: string | null
  last_status: number | null
  last_duration_ms: number | null
  alerted_at: string | Date | null
  created_at: string | Date
}

export type CronState = "ok" | "late" | "failing" | "waiting"

export interface CronJobHealth extends CronJob {
  state: CronState
  lastRunAt: string | null
  lastOkAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  lastDurationMs: number | null
  alertedAt: string | null
}

const iso = (v: string | Date | null | undefined): string | null => (v ? new Date(v).toISOString() : null)
const ms = (v: string | Date | null | undefined): number => (v ? new Date(v).getTime() : 0)

export function jobState(job: CronJob, row: CronRunRow | undefined, now: Date): CronState {
  const lateMs = lateAfterMinutes(job.intervalMin) * 60_000
  if (!row || !row.last_finished_at) {
    // Not run since monitoring started: late only once a full interval has passed.
    const since = row ? ms(row.created_at) : now.getTime()
    return now.getTime() - since > lateMs ? "late" : "waiting"
  }
  if (ms(row.last_error_at) > ms(row.last_ok_at)) return "failing"
  return now.getTime() - ms(row.last_finished_at) > lateMs ? "late" : "ok"
}

let ensured: Promise<void> | null = null

export function ensureCronRunsSchema(): Promise<void> {
  if (!ensured) {
    ensured = ddl`
      CREATE TABLE IF NOT EXISTS cron_runs (
        job TEXT PRIMARY KEY,
        last_finished_at TIMESTAMP WITH TIME ZONE,
        last_ok_at TIMESTAMP WITH TIME ZONE,
        last_error_at TIMESTAMP WITH TIME ZONE,
        last_error TEXT,
        last_status INTEGER,
        last_duration_ms INTEGER,
        alerted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `.then(() => undefined).catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

// Never throws: monitoring must not break the job it watches.
export async function recordCronRun(job: string, status: number, durationMs: number, error: string | null): Promise<void> {
  try {
    await ensureCronRunsSchema()
    const ok = status < 500 && !error
    const message = error ? error.slice(0, 300) : null
    await sql`
      INSERT INTO cron_runs (job, last_finished_at, last_ok_at, last_error_at, last_error, last_status, last_duration_ms)
      VALUES (${job}, NOW(), ${ok ? new Date() : null}, ${ok ? null : new Date()}, ${message}, ${status}, ${Math.round(durationMs)})
      ON CONFLICT (job) DO UPDATE SET
        last_finished_at = NOW(),
        last_ok_at = COALESCE(EXCLUDED.last_ok_at, cron_runs.last_ok_at),
        last_error_at = COALESCE(EXCLUDED.last_error_at, cron_runs.last_error_at),
        last_error = CASE WHEN EXCLUDED.last_error_at IS NULL THEN cron_runs.last_error ELSE EXCLUDED.last_error END,
        last_status = EXCLUDED.last_status,
        last_duration_ms = EXCLUDED.last_duration_ms
    `
  } catch (err) {
    console.error(`[cron-health] could not record ${job}:`, err instanceof Error ? err.message : err)
  }
}

async function errorFromResponse(res: Response): Promise<string> {
  try {
    const body = await res.clone().json()
    if (body && typeof body.error === "string") return `HTTP ${res.status}: ${body.error}`
  } catch {}
  return `HTTP ${res.status}`
}

// Wraps a cron route's GET. Requests the route refuses (401/403) are not runs.
export function monitorCron(job: string, handler: (request: NextRequest) => Promise<Response>) {
  return async function GET(request: NextRequest): Promise<Response> {
    const started = Date.now()
    let res: Response
    try {
      res = await handler(request)
    } catch (err) {
      await recordCronRun(job, 500, Date.now() - started, err instanceof Error ? err.message : String(err))
      throw err
    }
    if (res.status !== 401 && res.status !== 403) {
      await recordCronRun(job, res.status, Date.now() - started, res.status >= 500 ? await errorFromResponse(res) : null)
    }
    return res
  }
}

export async function cronHealth(now = new Date()): Promise<CronJobHealth[]> {
  await ensureCronRunsSchema()
  const rows = (await sql`SELECT * FROM cron_runs`) as CronRunRow[]
  const byJob = new Map(rows.map((r) => [r.job, r]))
  return CRON_JOBS.map((job) => {
    const row = byJob.get(job.name)
    return {
      ...job,
      state: jobState(job, row, now),
      lastRunAt: iso(row?.last_finished_at),
      lastOkAt: iso(row?.last_ok_at),
      lastErrorAt: iso(row?.last_error_at),
      lastError: row?.last_error ?? null,
      lastDurationMs: row?.last_duration_ms ?? null,
      alertedAt: iso(row?.alerted_at),
    }
  })
}

// A job is reported when it goes bad and again once a day while it stays bad;
// one "back to normal" note follows when it recovers.
export function alertsDue(jobs: CronJobHealth[], now: Date): { bad: CronJobHealth[]; recovered: CronJobHealth[] } {
  const day = 24 * 60 * 60_000
  const bad = jobs.filter(
    (j) => (j.state === "late" || j.state === "failing") && (!j.alertedAt || now.getTime() - ms(j.alertedAt) > day)
  )
  const recovered = jobs.filter((j) => j.state === "ok" && j.alertedAt)
  return { bad, recovered }
}

export async function markAlerted(bad: string[], recovered: string[]): Promise<void> {
  if (bad.length) {
    await sql`
      INSERT INTO cron_runs (job, alerted_at) SELECT unnest(${bad}::text[]), NOW()
      ON CONFLICT (job) DO UPDATE SET alerted_at = NOW()
    `
  }
  if (recovered.length) {
    await sql`UPDATE cron_runs SET alerted_at = NULL WHERE job = ANY(${recovered}::text[])`
  }
}

// Jobs with no row start their "waiting" clock now (first watch after deploy).
export async function registerCronJobs(): Promise<void> {
  await ensureCronRunsSchema()
  const names = CRON_JOBS.map((j) => j.name)
  await sql`INSERT INTO cron_runs (job) SELECT unnest(${names}::text[]) ON CONFLICT (job) DO NOTHING`
}
