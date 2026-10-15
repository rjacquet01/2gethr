'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { format, formatDistanceToNow, isToday, isPast, parseISO } from 'date-fns'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellRing,
  Calendar,
  CheckCircle2,
  ListTodo,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
} from 'lucide-react'
import { authFetch } from '@/hooks/use-auth'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/* ------------------------------------------------------------------ */
/* Shared geofence activity data (same endpoint as the Places page)   */
/* ------------------------------------------------------------------ */

interface ActivityEvent {
  id: string
  type: 'ARRIVAL' | 'DEPARTURE'
  at: string
  userId: string
  memberName: string
  isMe: boolean
  placeId: string
  placeName: string
  placeColor: string | null
}

interface ActivityResponse {
  scope: 'family' | 'self'
  events: ActivityEvent[]
}

const activityFetcher = async (url: string): Promise<ActivityResponse> => {
  const res = await authFetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  const json = await res.json()
  return json.data
}

function useGeofenceActivity(familyId: string | undefined) {
  return useSWR<ActivityResponse>(
    familyId ? `/api/places/activity?familyId=${familyId}` : null,
    activityFetcher,
    { refreshInterval: 60_000 }
  )
}

/* ------------------------------------------------------------------ */
/* Family status strip                                                */
/* ------------------------------------------------------------------ */

interface StripMember {
  id: string
  userId: string
  displayName: string
  avatarUrl: string | null
  color?: string | null
}

export function FamilyStatusStrip({
  familyId,
  members,
}: {
  familyId: string
  members: StripMember[]
}) {
  const { data, isLoading } = useGeofenceActivity(familyId)
  const events = data?.events ?? []
  const scopeSelf = data?.scope === 'self'

  // Events arrive newest-first, so the first match per member is the latest.
  const latestByUser = new Map<string, ActivityEvent>()
  for (const e of events) {
    if (!latestByUser.has(e.userId)) latestByUser.set(e.userId, e)
  }

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Family right now</p>
          <Button variant="ghost" size="sm" asChild className="gap-1 h-7 px-2">
            <Link href="/location">
              <Navigation className="w-3.5 h-3.5" />
              Live location
            </Link>
          </Button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          {members.map((m) => {
            const initials =
              m.displayName
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) || '?'
            const latest = latestByUser.get(m.userId)
            let status = 'No activity in 24h'
            let dot = 'bg-muted-foreground/40'
            if (latest) {
              const when = formatDistanceToNow(new Date(latest.at), { addSuffix: true })
              if (latest.type === 'ARRIVAL') {
                status = `At ${latest.placeName}`
                dot = 'bg-green-500'
              } else {
                status = `Left ${latest.placeName} ${when}`
                dot = 'bg-amber-500'
              }
            } else if (scopeSelf && isLoading === false) {
              // Kids only receive their own events; other members stay quiet.
              status = ''
            }
            return (
              <Link
                key={m.id}
                href="/location"
                className="flex items-center gap-3 rounded-xl border px-3 py-2 min-w-[168px] hover:bg-muted/50 transition-colors"
              >
                <div className="relative shrink-0">
                  <Avatar
                    className="w-10 h-10 border-2"
                    style={{ borderColor: m.color || undefined }}
                  >
                    <AvatarImage
                      src={m.avatarUrl ? `/api/files?pathname=${encodeURIComponent(m.avatarUrl)}` : undefined}
                      alt={m.displayName}
                    />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${dot}`}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.displayName}</p>
                  {isLoading ? (
                    <Skeleton className="h-3 w-20 mt-1" />
                  ) : (
                    status && (
                      <p className="text-xs text-muted-foreground truncate max-w-[110px]">{status}</p>
                    )
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Attention banner (only renders when something needs action)        */
/* ------------------------------------------------------------------ */

export function AttentionBanner({
  overdueTasks,
  approvals,
  overdueReminders,
}: {
  overdueTasks: number
  approvals: number
  overdueReminders: number
}) {
  const items: { key: string; text: string; href: string }[] = []
  if (approvals > 0) {
    items.push({
      key: 'approvals',
      text: `${approvals} task${approvals === 1 ? '' : 's'} waiting for approval`,
      href: '/tasks?status=pending_approval',
    })
  }
  if (overdueTasks > 0) {
    items.push({
      key: 'overdue',
      text: `${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'}`,
      href: '/tasks',
    })
  }
  if (overdueReminders > 0) {
    items.push({
      key: 'reminders',
      text: `${overdueReminders} reminder${overdueReminders === 1 ? '' : 's'} past due`,
      href: '/dashboard/reminders',
    })
  }
  if (items.length === 0) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
    >
      <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className="inline-flex items-center gap-1 text-sm font-medium text-destructive hover:underline"
        >
          {i.text}
          <ArrowRight className="w-3 h-3" />
        </Link>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Today timeline                                                     */
/* ------------------------------------------------------------------ */

interface TimelineEvent {
  id: string
  title: string
  startTime: string
  allDay?: boolean
  status?: string
  location?: string | null
}
interface TimelineReminder {
  id: string
  title: string
  remind_at: string
}
interface TimelineTask {
  id: string
  title: string
  status?: string
  dueDate?: string
  due_date?: string
}

type TimelineItem = {
  key: string
  kind: 'event' | 'reminder' | 'task'
  title: string
  href: string
  when: Date | null // null = all day / no time
  sub?: string
  overdue?: boolean
}

export function TodayTimeline({
  events,
  reminders,
  tasks,
  loading,
}: {
  events: TimelineEvent[]
  reminders: TimelineReminder[]
  tasks: TimelineTask[]
  loading?: boolean
}) {
  const now = new Date()
  const items: TimelineItem[] = []

  for (const e of events) {
    if (!e.startTime) continue
    const d = parseISO(e.startTime)
    if (!isToday(d)) continue
    items.push({
      key: `e-${e.id}`,
      kind: 'event',
      title: e.title,
      href: `/calendar/event/${e.id}`,
      when: e.allDay ? null : d,
      sub: e.allDay ? 'All day' : e.location || undefined,
    })
  }
  for (const r of reminders) {
    const d = parseISO(r.remind_at)
    if (!isToday(d) && !isPast(d)) continue
    items.push({
      key: `r-${r.id}`,
      kind: 'reminder',
      title: r.title,
      href: '/dashboard/reminders',
      when: d,
      overdue: isPast(d) && !isToday(d),
    })
  }
  for (const t of tasks) {
    const s = t.status?.toLowerCase()
    if (s === 'completed' || s === 'cancelled') continue
    const raw = t.dueDate || t.due_date
    if (!raw) continue
    const d = new Date(raw)
    const endOfDay = new Date(d)
    endOfDay.setHours(23, 59, 59, 999)
    const overdue = endOfDay < now
    if (!isToday(d) && !overdue) continue
    items.push({
      key: `t-${t.id}`,
      kind: 'task',
      title: t.title,
      href: `/tasks/${t.id}`,
      when: null,
      sub: overdue ? `Overdue · was due ${format(d, 'MMM d')}` : 'Due today',
      overdue,
    })
  }

  // all-day / untimed first, then by clock time
  items.sort((a, b) => {
    if (!a.when && !b.when) return Number(!!b.overdue) - Number(!!a.overdue)
    if (!a.when) return -1
    if (!b.when) return 1
    return a.when.getTime() - b.when.getTime()
  })

  const nowIndex = items.findIndex((i) => i.when && i.when.getTime() > now.getTime())

  const icon = (k: TimelineItem['kind'], overdue?: boolean) => {
    const cls = `w-4 h-4 ${overdue ? 'text-destructive' : ''}`
    if (k === 'event') return <Calendar className={`${cls} text-blue-500`} />
    if (k === 'reminder') return <Bell className={`${cls} ${overdue ? '' : 'text-amber-500'}`} />
    return <ListTodo className={`${cls} ${overdue ? '' : 'text-primary'}`} />
  }

  const NowMarker = () => (
    <li className="flex items-center gap-2 py-1" aria-label="Current time">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-primary w-14 shrink-0">
        Now
      </span>
      <span className="h-px flex-1 bg-primary/40" />
    </li>
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Today</CardTitle>
        <CardDescription>{format(now, 'EEEE, MMMM d')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
            Nothing scheduled for today. Enjoy the free time.
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((i, idx) => (
              <div key={i.key} className="contents">
                {idx === nowIndex && <NowMarker />}
                <li>
                  <Link
                    href={i.href}
                    className="flex items-center gap-2 rounded-lg px-1 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {i.when ? format(i.when, 'h:mm a') : i.kind === 'task' ? 'Task' : 'All day'}
                    </span>
                    {icon(i.kind, i.overdue)}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium truncate ${i.overdue ? 'text-destructive' : ''}`}>
                        {i.title}
                      </p>
                      {i.sub && <p className="text-xs text-muted-foreground truncate">{i.sub}</p>}
                    </div>
                  </Link>
                </li>
              </div>
            ))}
            {nowIndex === -1 && <NowMarker />}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Task progress (replaces the four equal status tiles)               */
/* ------------------------------------------------------------------ */

export function TaskProgress({
  counts,
  overdue,
}: {
  counts: { pending: number; inProgress: number; onHold: number; completed: number }
  overdue: number
}) {
  const total = counts.pending + counts.inProgress + counts.onHold + counts.completed + overdue
  const segs = [
    { key: 'completed', label: 'Done', n: counts.completed, bar: 'bg-green-500', href: '/tasks?status=completed' },
    { key: 'inProgress', label: 'Active', n: counts.inProgress, bar: 'bg-blue-500', href: '/tasks?status=in_progress' },
    { key: 'pending', label: 'Pending', n: counts.pending, bar: 'bg-gray-400', href: '/tasks?status=pending' },
    { key: 'onHold', label: 'On hold', n: counts.onHold, bar: 'bg-yellow-500', href: '/tasks?status=on_hold' },
    { key: 'overdue', label: 'Overdue', n: overdue, bar: 'bg-red-500', href: '/tasks' },
  ]
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Tasks</p>
          <Button variant="ghost" size="sm" asChild className="gap-1 h-7 px-2">
            <Link href="/tasks">
              All tasks
              <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        </div>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Task progress">
            {segs
              .filter((s) => s.n > 0)
              .map((s) => (
                <div key={s.key} className={s.bar} style={{ width: `${(s.n / total) * 100}%` }} />
              ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {segs.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted/50 transition-colors ${
                s.key === 'overdue' && s.n > 0 ? 'border-destructive/40 text-destructive font-medium' : ''
              } ${s.n === 0 ? 'opacity-60' : ''}`}
            >
              <span className={`w-2 h-2 rounded-full ${s.bar}`} />
              {s.n} {s.label}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Right-column panel: last 24h geofence activity + shortcuts         */
/* ------------------------------------------------------------------ */

export function DashboardActivityPanel({ familyId }: { familyId: string }) {
  const { data, isLoading } = useGeofenceActivity(familyId)
  const events = (data?.events ?? []).slice(0, 6)
  const everyone = data?.scope !== 'self'

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BellRing className="w-4 h-4 text-muted-foreground" />
              {everyone ? 'Family activity' : 'Your activity'}
            </CardTitle>
            <CardDescription>Last 24 hours</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild className="gap-1 h-7 px-2">
            <Link href="/places">
              Places
              <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No arrivals or departures yet today.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => {
              const arrival = e.type === 'ARRIVAL'
              return (
                <li key={e.id} className="flex items-center gap-2.5">
                  <div
                    className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${
                      arrival ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'
                    }`}
                  >
                    {arrival ? <LogIn className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">
                      <span className="font-medium">{e.isMe ? 'You' : e.memberName}</span>{' '}
                      {arrival ? 'arrived at' : 'left'}{' '}
                      <span className="font-medium">{e.placeName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(e.at), 'h:mm a')} ·{' '}
                      {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function DashboardShortcuts() {
  const links = [
    { href: '/location', label: 'Live location', icon: Navigation },
    { href: '/places', label: 'Saved places', icon: MapPin },
    { href: '/calendar', label: 'Calendar', icon: Calendar },
    { href: '/dashboard/reminders', label: 'Reminders', icon: Bell },
  ]
  return (
    <Card>
      <CardContent className="p-3 grid grid-cols-2 gap-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors"
          >
            <l.icon className="w-4 h-4 text-muted-foreground" />
            {l.label}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
