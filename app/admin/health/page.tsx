'use client'

import useSWR from 'swr'
import { Activity, CheckCircle, AlertTriangle, XCircle, Clock, RefreshCw } from 'lucide-react'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type CheckState = 'ok' | 'warn' | 'off'
type JobState = 'ok' | 'late' | 'failing' | 'waiting'

interface Health {
  checkedAt: string
  database: { ok: boolean; latencyMs: number | null }
  services: { name: string; state: CheckState; detail: string }[]
  deployment: { environment: string | null; commit: string | null; region: string | null }
  jobs: {
    name: string
    schedule: string
    intervalMin: number
    state: JobState
    lastRunAt: string | null
    lastOkAt: string | null
    lastError: string | null
    lastDurationMs: number | null
  }[]
  jobsError: string | null
}

const REFRESH_MS = 60_000

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

function every(min: number): string {
  if (min < 60) return min === 1 ? 'every minute' : `every ${min} min`
  if (min === 60) return 'hourly'
  if (min === 1440) return 'daily'
  return 'weekly'
}

const JOB_BADGE: Record<JobState, { label: string; className: string }> = {
  ok: { label: 'On time', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  waiting: { label: 'Waiting for first run', className: 'bg-muted text-muted-foreground' },
  late: { label: 'Late', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  failing: { label: 'Failing', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
}

function StateIcon({ state }: { state: CheckState }) {
  if (state === 'ok') return <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
  if (state === 'warn') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
  return <XCircle className="h-4 w-4 shrink-0 text-red-600" />
}

async function fetchHealth(url: string): Promise<Health> {
  const token = getAdminAccessToken()
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load health')
  return data
}

export default function AdminHealthPage() {
  const { data: health, error: loadError, isValidating, mutate } = useSWR('/api/admin/health', fetchHealth, {
    refreshInterval: REFRESH_MS,
  })
  const error = loadError ? (loadError as Error).message : null
  const refreshing = isValidating

  const attention = health?.jobs.filter((j) => j.state === 'late' || j.state === 'failing') ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Activity className="h-6 w-6" />
            System Health
          </h1>
          <p className="text-sm text-muted-foreground">
            Database, settings and scheduled jobs. Refreshes every minute
            {health ? `; checked ${new Date(health.checkedAt).toLocaleTimeString()}` : ''}.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          disabled={refreshing}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-300">
          <CardContent className="py-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {!health && !error ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : health ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Database and deployment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <StateIcon state={health.database.ok ? 'ok' : 'off'} />
                  <span className="font-medium">Database</span>
                  <span className="text-muted-foreground">
                    {health.database.ok ? `reachable, ${health.database.latencyMs} ms` : 'unreachable'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StateIcon state={attention.length ? 'warn' : 'ok'} />
                  <span className="font-medium">Scheduled jobs</span>
                  <span className="text-muted-foreground">
                    {attention.length ? `${attention.length} need attention` : 'all on time'}
                  </span>
                </div>
                <p className="pt-2 text-muted-foreground">
                  {health.deployment.environment ?? 'unknown'}
                  {health.deployment.commit ? ` · ${health.deployment.commit}` : ''}
                  {health.deployment.region ? ` · ${health.deployment.region}` : ''}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Services</CardTitle>
                <CardDescription>Whether each one is set up. Values are never shown.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {health.services.map((s) => (
                  <div key={s.name} className="flex items-start gap-2">
                    <span className="mt-0.5"><StateIcon state={s.state} /></span>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">{s.detail}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scheduled jobs</CardTitle>
              <CardDescription>
                You get an email when a job is late or failing (then daily while it stays that way) and when it recovers.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {health.jobsError ? (
                <p className="text-sm text-red-700">{health.jobsError}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Runs</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Last success</TableHead>
                      <TableHead>Took</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {health.jobs.map((j) => (
                      <TableRow key={j.name}>
                        <TableCell className="font-mono text-xs">{j.name}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          <Clock className="mr-1 inline h-3 w-3" />
                          {every(j.intervalMin)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={JOB_BADGE[j.state].className}>
                            {JOB_BADGE[j.state].label}
                          </Badge>
                          {j.state === 'failing' && j.lastError && (
                            <p className="mt-1 max-w-xs truncate text-xs text-red-700" title={j.lastError}>
                              {j.lastError}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{ago(j.lastRunAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">{ago(j.lastOkAt)}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {j.lastDurationMs != null ? `${(j.lastDurationMs / 1000).toFixed(1)} s` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
