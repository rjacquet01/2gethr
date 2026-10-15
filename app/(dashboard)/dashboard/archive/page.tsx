'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowLeft,
  Archive,
  RotateCcw,
  Trash2,
  ListTodo,
  Calendar,
  Bell,
  Search,
  CheckSquare,
  Square,
  X,
} from 'lucide-react'
import {
  differenceInCalendarDays,
  format,
  isThisMonth,
  isThisYear,
  isToday,
  isYesterday,
  parseISO,
} from 'date-fns'
import { toast } from 'sonner'
import { authFetch } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

interface ArchivedTask {
  id: string
  title: string
  description?: string
  status: string
  priority?: string
  category?: string
  dueDate?: string
  updatedAt: string
  creatorName?: string
}

interface ArchivedEvent {
  id: string
  title: string
  description?: string
  startTime: string
  endTime?: string
  location?: string
  updatedAt: string
  calendarName?: string
}

interface ArchivedReminder {
  id: string
  title: string
  description?: string
  status: string
  remind_at: string
  updated_at: string
}

type Kind = 'task' | 'event' | 'reminder'
type Filter = 'all' | Kind

interface Item {
  key: string
  kind: Kind
  id: string
  title: string
  sub: string
  when: Date // when it was archived / last changed
}

const KIND_META: Record<Kind, { label: string; plural: string; icon: typeof Bell; tone: string }> = {
  task: { label: 'Task', plural: 'Tasks', icon: ListTodo, tone: 'bg-blue-500/10 text-blue-600' },
  event: { label: 'Event', plural: 'Events', icon: Calendar, tone: 'bg-emerald-500/10 text-emerald-600' },
  reminder: { label: 'Reminder', plural: 'Reminders', icon: Bell, tone: 'bg-amber-500/10 text-amber-600' },
}

function bucketOf(d: Date): string {
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  if (differenceInCalendarDays(new Date(), d) <= 7) return 'This week'
  if (isThisMonth(d)) return 'Earlier this month'
  return format(d, isThisYear(d) ? 'MMMM' : 'MMMM yyyy')
}

export default function ArchivePage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [tasks, setTasks] = useState<ArchivedTask[]>([])
  const [events, setEvents] = useState<ArchivedEvent[]>([])
  const [reminders, setReminders] = useState<ArchivedReminder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [historyDays, setHistoryDays] = useState<number | null>(null)
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const fetchArchivedItems = useCallback(async () => {
    setIsLoading(true)
    try {
      const [tasksRes, eventsRes, remindersRes] = await Promise.all([
        authFetch('/api/tasks/archive'),
        authFetch('/api/events?status=ARCHIVED'),
        // A reminder has no separate "archive" step - completing or
        // dismissing it is the end of its active life - so ?status=ARCHIVED
        // means "everything no longer active" (COMPLETED, DISMISSED, ARCHIVED).
        authFetch('/api/reminders?status=ARCHIVED'),
      ])
      if (tasksRes.ok) {
        const d = await tasksRes.json()
        setTasks(d.tasks || [])
        if (typeof d.historyDays === 'number') setHistoryDays(d.historyDays)
      }
      if (eventsRes.ok) {
        const d = await eventsRes.json()
        setEvents(d.events || [])
      }
      if (remindersRes.ok) {
        const d = await remindersRes.json()
        setReminders(d.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch archived items:', error)
      toast.error('Could not load the archive')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchArchivedItems()
  }, [fetchArchivedItems])

  const items: Item[] = useMemo(() => {
    const safe = (s?: string) => {
      const d = s ? parseISO(s) : new Date(0)
      return Number.isNaN(d.getTime()) ? new Date(0) : d
    }
    const t: Item[] = tasks.map((x) => ({
      key: `task:${x.id}`,
      kind: 'task',
      id: x.id,
      title: x.title,
      sub: [x.category, x.priority && x.priority.toLowerCase() !== 'medium' ? `${x.priority.toLowerCase()} priority` : null]
        .filter(Boolean)
        .join(' · '),
      when: safe(x.updatedAt),
    }))
    const e: Item[] = events.map((x) => ({
      key: `event:${x.id}`,
      kind: 'event',
      id: x.id,
      title: x.title,
      sub: [x.startTime ? format(safe(x.startTime), 'MMM d, yyyy') : null, x.location].filter(Boolean).join(' · '),
      when: safe(x.updatedAt),
    }))
    const r: Item[] = reminders.map((x) => ({
      key: `reminder:${x.id}`,
      kind: 'reminder',
      id: x.id,
      title: x.title,
      sub: x.status === 'COMPLETED' ? 'Completed' : x.status === 'DISMISSED' ? 'Dismissed' : 'Archived',
      when: safe(x.updated_at),
    }))
    return [...t, ...e, ...r].sort((a, b) => b.when.getTime() - a.when.getTime())
  }, [tasks, events, reminders])

  const q = query.trim().toLowerCase()
  const visible = items.filter(
    (i) => (filter === 'all' || i.kind === filter) && (!q || i.title.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q))
  )

  const grouped = useMemo(() => {
    const out: Array<{ label: string; rows: Item[] }> = []
    for (const it of visible) {
      const label = bucketOf(it.when)
      const last = out[out.length - 1]
      if (last && last.label === label) last.rows.push(it)
      else out.push({ label, rows: [it] })
    }
    return out
  }, [visible])

  const setBusy = (keys: string[], on: boolean) =>
    setBusyKeys((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)))
      return next
    })

  const removeLocal = (it: Item) => {
    if (it.kind === 'task') setTasks((p) => p.filter((x) => x.id !== it.id))
    else if (it.kind === 'event') setEvents((p) => p.filter((x) => x.id !== it.id))
    else setReminders((p) => p.filter((x) => x.id !== it.id))
  }

  // Returns true on success. events.status is a Postgres enum with no
  // CONFIRMED value - APPROVED is the normal non-archived status.
  const restoreOne = async (it: Item): Promise<boolean> => {
    try {
      const res =
        it.kind === 'task'
          ? await authFetch(`/api/tasks/${it.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'unarchive' }),
            })
          : it.kind === 'event'
            ? await authFetch(`/api/events/${it.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'APPROVED' }),
              })
            : await authFetch(`/api/reminders/${it.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'restore' }),
              })
      if (res.ok) removeLocal(it)
      return res.ok
    } catch (error) {
      console.error('Failed to restore item:', error)
      return false
    }
  }

  const deleteOne = async (it: Item): Promise<boolean> => {
    const path = it.kind === 'task' ? 'tasks' : it.kind === 'event' ? 'events' : 'reminders'
    try {
      const res = await authFetch(`/api/${path}/${it.id}`, { method: 'DELETE' })
      if (res.ok) removeLocal(it)
      return res.ok
    } catch (error) {
      console.error('Failed to delete item:', error)
      return false
    }
  }

  const handleRestore = async (it: Item) => {
    setBusy([it.key], true)
    const ok = await restoreOne(it)
    setBusy([it.key], false)
    if (ok) toast.success(`${KIND_META[it.kind].label} restored`)
    else toast.error('Could not restore - try again')
  }

  const handleDelete = async (it: Item) => {
    if (!confirm(`Permanently delete this ${KIND_META[it.kind].label.toLowerCase()}? This can't be undone.`)) return
    setBusy([it.key], true)
    const ok = await deleteOne(it)
    setBusy([it.key], false)
    if (ok) toast.success('Deleted')
    else toast.error('Could not delete - try again')
  }

  const selectedItems = items.filter((i) => selected.has(i.key))

  const bulk = async (mode: 'restore' | 'delete') => {
    if (selectedItems.length === 0) return
    if (
      mode === 'delete' &&
      !confirm(`Permanently delete ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}? This can't be undone.`)
    )
      return
    const keys = selectedItems.map((i) => i.key)
    setBusy(keys, true)
    let ok = 0
    for (const it of selectedItems) {
      if (await (mode === 'restore' ? restoreOne(it) : deleteOne(it))) ok++
    }
    setBusy(keys, false)
    setSelected(new Set())
    if (ok === selectedItems.length) toast.success(`${mode === 'restore' ? 'Restored' : 'Deleted'} ${ok}`)
    else toast.error(`${mode === 'restore' ? 'Restored' : 'Deleted'} ${ok} of ${selectedItems.length} - some failed`)
    if (items.length - ok === 0) setSelecting(false)
  }

  const toggleSelected = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const counts = { all: items.length, task: tasks.length, event: events.length, reminder: reminders.length }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24 sm:space-y-5 lg:pb-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" asChild className="h-9 w-9 shrink-0" aria-label="Back to dashboard">
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">Archive</h1>
            <p className="truncate text-sm text-muted-foreground">
              {items.length} item{items.length === 1 ? '' : 's'}
              {historyDays ? ` · your plan keeps ${historyDays} days of history` : ''}
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <Button
            variant={selecting ? 'secondary' : 'outline'}
            size="sm"
            className="shrink-0"
            onClick={() => {
              setSelecting((v) => !v)
              setSelected(new Set())
            }}
          >
            {selecting ? <X className="mr-1 h-4 w-4" /> : <CheckSquare className="mr-1 h-4 w-4" />}
            {selecting ? 'Done' : 'Select'}
          </Button>
        )}
      </div>

      {/* Search + type */}
      {items.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the archive"
              className="h-10 pl-9"
              aria-label="Search the archive"
            />
          </div>
          <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-1">
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'task', label: 'Tasks' },
                { key: 'event', label: 'Events' },
                { key: 'reminder', label: 'Reminders' },
              ] as Array<{ key: Filter; label: string }>
            ).map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setFilter(d.key)}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  filter === d.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {d.label}
                <span className="ml-1.5 text-xs text-muted-foreground">{counts[d.key]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty */}
      {visible.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <Archive className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">{q || filter !== 'all' ? 'Nothing matches' : 'No archived items'}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground/70">
              {q || filter !== 'all'
                ? 'Try a different search or filter.'
                : 'Completed tasks, past events, and finished reminders will appear here when archived.'}
            </p>
            {(q || filter !== 'all') && (
              <Button
                variant="link"
                className="mt-2"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                Clear search and filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <div className="space-y-5">
        {grouped.map((g) => (
          <section key={g.label}>
            <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
              {g.label}
              <span className="ml-1 text-xs font-normal">{g.rows.length}</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {g.rows.map((it) => {
                const meta = KIND_META[it.kind]
                const Icon = meta.icon
                const busy = busyKeys.has(it.key)
                const isSel = selected.has(it.key)
                return (
                  <div
                    key={it.key}
                    className={cn(
                      'flex min-w-0 items-center gap-3 rounded-lg border bg-card p-3',
                      isSel && 'border-primary bg-primary/5'
                    )}
                  >
                    {selecting ? (
                      <button
                        type="button"
                        onClick={() => toggleSelected(it.key)}
                        aria-label={isSel ? 'Deselect' : 'Select'}
                        className="shrink-0 text-primary"
                      >
                        {isSel ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5 text-muted-foreground" />}
                      </button>
                    ) : (
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', meta.tone)} title={meta.label}>
                        <Icon className="h-4 w-4" />
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={!selecting}
                      onClick={() => selecting && toggleSelected(it.key)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium">{it.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {it.sub && <>{it.sub} · </>}
                        {format(it.when, 'MMM d, yyyy')}
                      </p>
                    </button>
                    {!selecting && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRestore(it)}
                          disabled={busy}
                          aria-label={`Restore ${it.title}`}
                          title="Restore"
                        >
                          {busy ? <Spinner className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(it)}
                          disabled={busy}
                          aria-label={`Delete ${it.title}`}
                          title="Delete permanently"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Bulk action bar */}
      {selecting && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-4 lg:bottom-6 lg:left-auto lg:right-6 lg:px-0">
          <div className="mx-auto flex max-w-md items-center gap-2 rounded-xl border bg-background p-2 shadow-lg">
            <button
              type="button"
              className="px-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={() =>
                setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((v) => v.key)))
              }
            >
              {selected.size === visible.length && visible.length > 0 ? 'None' : 'All'}
            </button>
            <span className="flex-1 text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => bulk('restore')}>
              <RotateCcw className="mr-1 h-4 w-4" />
              Restore
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={selected.size === 0}
              onClick={() => bulk('delete')}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
