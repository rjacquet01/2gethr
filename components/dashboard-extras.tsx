'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import { addDays, endOfDay, format, isTomorrow, parseISO } from 'date-fns'
import { CalendarDays, CheckSquare, Bell, MapPin } from 'lucide-react'
import { authFetch } from '@/hooks/use-auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmergencyAlertButton } from '@/components/emergency-alert-button'

const FamilyLiveMap = dynamic(
  () => import('@/components/family-live-map').then((m) => m.FamilyLiveMap),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> }
)

/* ------------------------------ Mini map ------------------------------ */

const fetcher = async (url: string) => {
  const res = await authFetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) {
    const err: any = new Error(json?.error || 'Request failed')
    err.code = json?.code
    throw err
  }
  return json.data as any[]
}

export function DashboardMiniMap({ familyId }: { familyId: string }) {
  const { data, error, isLoading } = useSWR(
    familyId ? `/api/location?familyId=${encodeURIComponent(familyId)}` : null,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: true }
  )
  const withFix = (data || []).filter((m) => m.location)

  return (
    <Card className="gap-3 py-4 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between px-4 py-0">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          Family map
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <Link href="/location">Open</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 py-0">
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : error ? (
          <p className="px-4 pb-1 text-sm text-muted-foreground">
            {error.code === 'SUBSCRIPTION_REQUIRED'
              ? 'Live location is a Premium feature.'
              : 'Locations are unavailable right now.'}
          </p>
        ) : withFix.length === 0 ? (
          <p className="px-4 pb-1 text-sm text-muted-foreground">
            No one is sharing a location yet.
          </p>
        ) : (
          <FamilyLiveMap members={data as any} familyId={familyId} className="h-56 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------- Floating emergency ------------------------- */

// Only renders anything for users the emergency-alert API deems eligible
// (premium parents/guardians). Kids and everyone else get null.
export function FloatingEmergencyButton({ familyId }: { familyId: string }) {
  return (
    <div className="fixed bottom-20 right-4 z-40 rounded-full bg-background shadow-lg md:bottom-6 md:right-6 empty:hidden">
      <EmergencyAlertButton familyId={familyId} />
    </div>
  )
}

/* ------------------------------ Coming up ------------------------------ */

interface UEvent { id: string; title: string; startTime: string; status?: string }
interface UReminder { id: string; title: string; remind_at: string }
interface UTask { id: string; title: string; status?: string; dueDate?: string; due_date?: string | null }

type Row = { key: string; at: Date; title: string; href: string; kind: 'event' | 'task' | 'reminder' }

export function ComingUp({
  events,
  reminders,
  tasks,
  loading,
}: {
  events: UEvent[]
  reminders: UReminder[]
  tasks: UTask[]
  loading?: boolean
}) {
  const afterToday = endOfDay(new Date())
  const horizon = endOfDay(addDays(new Date(), 7))
  const rows: Row[] = []

  for (const e of events || []) {
    if (!e.startTime || e.status === 'CANCELLED' || e.status === 'REJECTED') continue
    const d = parseISO(e.startTime)
    if (d > afterToday && d <= horizon)
      rows.push({ key: 'e' + e.id, at: d, title: e.title, href: '/calendar', kind: 'event' })
  }
  for (const t of tasks || []) {
    const raw = t.dueDate || t.due_date
    if (!raw || (!['pending', 'in_progress'].includes((t.status || '').toLowerCase()))) continue
    const d = parseISO(raw)
    if (d > afterToday && d <= horizon)
      rows.push({ key: 't' + t.id, at: d, title: t.title, href: '/tasks', kind: 'task' })
  }
  for (const r of reminders || []) {
    if (!r.remind_at) continue
    const d = parseISO(r.remind_at)
    if (d > afterToday && d <= horizon)
      rows.push({ key: 'r' + r.id, at: d, title: r.title, href: '/dashboard/reminders', kind: 'reminder' })
  }
  rows.sort((a, b) => a.at.getTime() - b.at.getTime())
  const shown = rows.slice(0, 5)
  const Icon = { event: CalendarDays, task: CheckSquare, reminder: Bell }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 py-0">
        <CardTitle className="text-base">Coming up</CardTitle>
        <span className="text-xs text-muted-foreground">Next 7 days</span>
      </CardHeader>
      <CardContent className="px-4 py-0">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled after today.</p>
        ) : (
          <ul className="divide-y">
            {shown.map((r) => {
              const I = Icon[r.kind]
              return (
                <li key={r.key}>
                  <Link href={r.href} className="flex items-center gap-3 py-2 text-sm hover:text-primary">
                    <I className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {isTomorrow(r.at) ? 'Tomorrow' : format(r.at, 'EEE, MMM d')}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex gap-3 pt-2 text-xs">
          <Link href="/calendar" className="text-primary hover:underline">Calendar</Link>
          <Link href="/tasks" className="text-primary hover:underline">All tasks</Link>
          <Link href="/dashboard/reminders" className="text-primary hover:underline">Reminders</Link>
        </div>
      </CardContent>
    </Card>
  )
}
