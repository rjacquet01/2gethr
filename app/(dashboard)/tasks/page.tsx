'use client'

import { formatCategory } from '@/lib/categories'
import { useEffect, useState } from 'react'
import { useFamilies } from '@/hooks/use-family'
import { useAuth } from '@/hooks/use-auth'
import { useTasks, updateTask } from '@/hooks/use-tasks'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import {
  ListTodo,
  Plus,
  Check,
  X,
  Play,
  Pause,
  Clock,
  Star,
  MoreHorizontal,
  Archive,
  Calendar,
  Circle,
  CheckCircle2,
  Hourglass,
  Repeat,
  Flag,
  Umbrella,
  ChevronDown,
  ChevronRight,
  MessageSquare,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFavorites } from '@/components/favorites-dropdown'
import { useCalendarWeather } from '@/components/calendar-extras'
import {
  ACTIVE,
  OUTDOOR,
  PersonProgress,
  QuickAdd,
  dueText,
  groupTasks,
  initialsOf,
  norm,
  type GroupKey,
  type Person,
} from '@/components/tasks-extras'
import Link from 'next/link'
import { toast } from 'sonner'
import { format, parseISO, isPast } from 'date-fns'
import { cn } from '@/lib/utils'

type TaskT = ReturnType<typeof useTasks>['tasks'][number]
type Action = 'start' | 'complete' | 'approve' | 'reject' | 'hold' | 'resume' | 'pending' | 'cancel' | 'archive'
type Tab = 'mine' | 'everyone' | 'approval'
type Chip = 'overdue' | 'in_progress' | 'pending' | 'pending_approval' | 'on_hold' | 'completed'

const GROUPS: Array<{ key: GroupKey; label: string; tone: string }> = [
  { key: 'overdue', label: 'Overdue', tone: 'text-red-600' },
  { key: 'today', label: 'Today', tone: 'text-primary' },
  { key: 'week', label: 'This week', tone: 'text-foreground' },
  { key: 'later', label: 'Later', tone: 'text-foreground' },
  { key: 'nodate', label: 'No due date', tone: 'text-muted-foreground' },
  { key: 'closed', label: 'Done, on hold & cancelled', tone: 'text-muted-foreground' },
]

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-600',
  high: 'text-orange-500',
}

export default function TasksPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const { user } = useAuth() as unknown as { user?: { id: string } | null }
  const primaryFamily = families[0]
  const weather = useCalendarWeather(primaryFamily?.id)

  const { tasks: allTasksRaw, isLoading: tasksLoading, mutate } = useTasks(primaryFamily?.id)
  const allTasks = allTasksRaw.filter((t) => norm(t.status) !== 'archived')

  const [tabState, setTabState] = useState<Tab | null>(null)
  const [chip, setChip] = useState<Chip | null>(null)
  const [personKey, setPersonKey] = useState<string>('all')
  const [showClosed, setShowClosed] = useState(false)
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null)

  // Dashboard links open this page pre-filtered (/tasks?status=on_hold etc.).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status')
    const chips: Chip[] = ['overdue', 'in_progress', 'pending', 'pending_approval', 'on_hold', 'completed']
    if (status && (chips as string[]).includes(status)) {
      setChip(status as Chip)
      setTabState(status === 'pending_approval' ? 'approval' : 'everyone')
    }
  }, [])
  const { isFavorite, toggleFavorite } = useFavorites()

  const members = primaryFamily?.members || []
  const kids = primaryFamily?.children || []
  const me = members.find((m) => user && String(m.userId) === String(user.id))
  const isManager = me?.role === 'PARENT' || me?.role === 'GUARDIAN'
  const myChildIds = kids.filter((c) => me && c.familyMemberId === me.id).map((c) => c.id)

  const people: Person[] = [
    ...members.filter((m) => m.isActive !== false).map((m) => ({
      key: 'u' + m.userId,
      name: m.displayName,
      userId: m.userId,
      color: m.color,
    })),
    ...kids.filter((c) => !c.hasLogin && !c.familyMemberId).map((c) => ({
      key: 'c' + c.id,
      name: c.displayName,
      childId: c.id,
      color: c.color,
    })),
  ]

  const isMine = (t: TaskT) =>
    (!!user && t.assigned_to_id === user.id) || (!!t.child_profile_id && myChildIds.includes(t.child_profile_id))

  const awaitingAll = allTasks.filter((t) => norm(t.status) === 'pending_approval')
  const defaultTab: Tab = isManager
    ? awaitingAll.length > 0 ? 'approval' : 'everyone'
    : allTasks.some(isMine) ? 'mine' : 'everyone'
  const tab = tabState ?? defaultTab

  const person = people.find((p) => p.key === personKey)
  const matchesPerson = (t: TaskT) =>
    personKey === 'all' ||
    (personKey === 'none'
      ? !t.assigned_to_id && !t.child_profile_id
      : !!person && ((person.userId && t.assigned_to_id === person.userId) || (person.childId && t.child_profile_id === person.childId)))

  const scoped = allTasks.filter((t) =>
    tab === 'mine' ? isMine(t) : tab === 'approval' ? norm(t.status) === 'pending_approval' : matchesPerson(t)
  )

  const overdueOf = (t: TaskT) => !!t.due_date && ACTIVE.includes(norm(t.status)) && isPast(parseISO(t.due_date))
  const count = {
    overdue: scoped.filter(overdueOf).length,
    in_progress: scoped.filter((t) => norm(t.status) === 'in_progress').length,
    pending: scoped.filter((t) => norm(t.status) === 'pending').length,
    pending_approval: scoped.filter((t) => norm(t.status) === 'pending_approval').length,
    on_hold: scoped.filter((t) => norm(t.status) === 'on_hold').length,
    completed: scoped.filter((t) => norm(t.status) === 'completed').length,
  }

  const visible = scoped.filter((t) => {
    if (!chip) return true
    if (chip === 'overdue') return overdueOf(t)
    return norm(t.status) === chip
  })
  const groups = groupTasks(visible)
  const closedOpen = showClosed || chip === 'on_hold' || chip === 'completed'

  const handleTaskAction = async (taskId: string, action: Action) => {
    setProcessingTaskId(taskId)
    try {
      await updateTask(taskId, action)
      mutate()
      const messages: Record<string, string> = {
        start: 'Task started',
        complete: 'Task completed',
        approve: 'Task approved',
        reject: 'Task sent back',
        hold: 'Task put on hold',
        resume: 'Task resumed',
        pending: 'Task set to pending',
        cancel: 'Task cancelled',
        archive: 'Task archived',
      }
      toast.success(messages[action] || 'Task updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update task')
    } finally {
      setProcessingTaskId(null)
    }
  }

  const assignToMe = async (taskId: string) => {
    if (!user) return
    setProcessingTaskId(taskId)
    try {
      await updateTask(taskId, 'update', { assignedToUserId: user.id })
      mutate()
      toast.success('Assigned to you')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not assign task')
    } finally {
      setProcessingTaskId(null)
    }
  }

  const statusBadge = (status: string) => {
    switch (norm(status)) {
      case 'pending': return <Badge variant="secondary">Pending</Badge>
      case 'in_progress': return <Badge className="bg-blue-500 text-white">In Progress</Badge>
      case 'pending_approval': return <Badge className="bg-orange-500 text-white">Awaiting Approval</Badge>
      case 'completed': return <Badge className="bg-green-500 text-white">Completed</Badge>
      case 'on_hold': return <Badge className="bg-yellow-500 text-white">On Hold</Badge>
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  if (familiesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!primaryFamily) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Empty title="No family yet" description="Create or join a family to start managing tasks" />
        <Button asChild className="mt-6">
          <Link href="/onboarding">Get Started</Link>
        </Button>
      </div>
    )
  }

  const renderRow = (task: TaskT) => {
    const status = norm(task.status)
    const assigneeName = task.child_display_name
      ? task.child_display_name
      : task.assignee_first_name
        ? `${task.assignee_first_name} ${task.assignee_last_name || ''}`.trim()
        : 'Unassigned'
    const assigneeAvatarSrc = task.child_avatar_url
      ? task.child_avatar_url
      : task.assigned_to_id && task.assignee_profile_photo_path
        ? `/api/avatar/${task.assigned_to_id}`
        : undefined
    const unassigned = assigneeName === 'Unassigned'
    const overdue = overdueOf(task)
    const busy = processingTaskId === task.id
    const dueKey = task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : ''
    const w = dueKey ? weather[dueKey] : undefined
    const rainHint =
      !!w && w.rain >= 50 && ACTIVE.includes(status) && OUTDOOR.test(`${task.title} ${task.category || ''}`)
    const t = task as TaskT & { is_recurring?: boolean; comment_count?: number | string }
    const comments = Number(t.comment_count || 0)
    const pr = norm(task.priority)

    return (
      <div
        key={task.id}
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3 transition-colors sm:items-center',
          status === 'pending_approval'
            ? 'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20'
            : overdue
              ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
              : 'border-border hover:bg-muted/50',
          (status === 'cancelled' || status === 'completed') && 'opacity-70'
        )}
      >
        {/* One-tap complete */}
        <button
          type="button"
          disabled={busy || status === 'pending_approval' || status === 'cancelled'}
          onClick={() => handleTaskAction(task.id, status === 'completed' ? 'pending' : 'complete')}
          className="mt-0.5 shrink-0 rounded-full sm:mt-0"
          aria-label={status === 'completed' ? 'Mark as not done' : 'Mark as done'}
          title={status === 'pending_approval' ? 'Waiting for a parent to approve' : status === 'completed' ? 'Mark as not done' : 'Mark as done'}
        >
          {busy ? (
            <Spinner className="h-6 w-6" />
          ) : status === 'completed' ? (
            <CheckCircle2 className="h-6 w-6 text-green-500" />
          ) : status === 'pending_approval' ? (
            <Hourglass className="h-6 w-6 text-orange-500" />
          ) : (
            <Circle className={cn('h-6 w-6', status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground hover:text-green-500')} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <Link href={`/tasks/${task.id}`} className="hover:underline">
            <p className={cn('truncate font-medium text-foreground', status === 'completed' && 'line-through')}>{task.title}</p>
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Avatar className="h-4 w-4">
                {assigneeAvatarSrc && <AvatarImage src={assigneeAvatarSrc} alt={assigneeName} />}
                <AvatarFallback className="bg-primary/10 text-[9px] text-primary">
                  {unassigned ? '?' : initialsOf(assigneeName)}
                </AvatarFallback>
              </Avatar>
              {assigneeName}
              {unassigned && user && ACTIVE.includes(status) && (
                <button
                  type="button"
                  onClick={() => assignToMe(task.id)}
                  className="ml-1 rounded border px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                >
                  Assign to me
                </button>
              )}
            </span>
            {task.due_date && (
              <span className={cn('flex items-center gap-1 text-xs', overdue ? 'font-medium text-red-600' : 'text-muted-foreground')}>
                <Calendar className="h-3 w-3" />
                {dueText(task.due_date)}
              </span>
            )}
            {(pr === 'urgent' || pr === 'high') && (
              <span className={cn('flex items-center gap-1 text-xs font-medium', PRIORITY_COLOR[pr])}>
                <Flag className="h-3 w-3" />
                {pr === 'urgent' ? 'Urgent' : 'High'}
              </span>
            )}
            {t.is_recurring && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Repeats">
                <Repeat className="h-3 w-3" />
                Repeats
              </span>
            )}
            {comments > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MessageSquare className="h-3 w-3" />
                {comments}
              </span>
            )}
            {rainHint && w && (
              <span className="flex items-center gap-1 text-xs text-sky-700" title={`${w.rain}% chance of rain that day`}>
                <Umbrella className="h-3 w-3" />
                {w.rain}% rain
              </span>
            )}
            {task.category && (
              <Badge variant="outline" className="text-xs">{formatCategory(task.category)}</Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => toggleFavorite('task', task.id)} aria-label="Favorite">
            <Star className={cn('h-4 w-4', isFavorite('task', task.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
          </Button>
          <span className="hidden sm:inline-flex">{statusBadge(task.status)}</span>

          {status === 'pending_approval' && isManager && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-green-600 hover:bg-green-100 hover:text-green-700" onClick={() => handleTaskAction(task.id, 'approve')} disabled={busy} aria-label="Approve">
                <Check className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => handleTaskAction(task.id, 'reject')} disabled={busy} aria-label="Send back">
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {status !== 'pending_approval' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy} className="h-8 px-2" aria-label="Change status">
                  <MoreHorizontal className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Status</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {status !== 'pending' && (
                  <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'pending')}>
                    <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                    Pending
                  </DropdownMenuItem>
                )}
                {status !== 'in_progress' && (
                  <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'start')}>
                    <Play className="mr-2 h-4 w-4 text-blue-500" />
                    Start (In Progress)
                  </DropdownMenuItem>
                )}
                {status !== 'on_hold' && (
                  <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'hold')}>
                    <Pause className="mr-2 h-4 w-4 text-yellow-500" />
                    Hold
                  </DropdownMenuItem>
                )}
                {status !== 'completed' && (
                  <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'complete')} className="text-green-600">
                    <Check className="mr-2 h-4 w-4" />
                    Complete
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {status !== 'cancelled' && (
                  <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'cancel')} className="text-red-600">
                    <X className="mr-2 h-4 w-4" />
                    Cancelled
                  </DropdownMenuItem>
                )}
                {(status === 'completed' || status === 'cancelled') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'archive')} className="text-muted-foreground">
                      <Archive className="mr-2 h-4 w-4" />
                      Archive
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    )
  }

  const chipDefs: Array<{ key: Chip; label: string; dot: string; n: number }> = [
    { key: 'overdue', label: 'Overdue', dot: 'bg-red-500', n: count.overdue },
    { key: 'in_progress', label: 'Active', dot: 'bg-blue-500', n: count.in_progress },
    { key: 'pending', label: 'Pending', dot: 'bg-gray-400', n: count.pending },
    { key: 'pending_approval', label: 'Approval', dot: 'bg-orange-500', n: count.pending_approval },
    { key: 'on_hold', label: 'On hold', dot: 'bg-yellow-500', n: count.on_hold },
    { key: 'completed', label: 'Done', dot: 'bg-green-500', n: count.completed },
  ]

  const tabDefs: Array<{ key: Tab; label: string; n?: number; show: boolean }> = [
    { key: 'mine', label: 'Mine', show: true },
    { key: 'everyone', label: 'Everyone', show: true },
    { key: 'approval', label: 'Needs approval', n: awaitingAll.length, show: isManager },
  ]

  const nothing = visible.length === 0

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Tasks</h1>
          <p className="text-sm text-muted-foreground">{primaryFamily.name}</p>
        </div>
        <Button asChild size="sm" className="self-start sm:self-auto">
          <Link href="/tasks/new">
            <Plus className="mr-1 h-4 w-4 sm:mr-2" />
            <span className="text-sm">New Task</span>
          </Link>
        </Button>
      </div>

      <QuickAdd familyId={primaryFamily.id} people={people} onCreated={() => mutate()} />

      {/* Who */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {tabDefs.filter((d) => d.show).map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => {
                setTabState(d.key)
                setChip(null)
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === d.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {d.label}
              {!!d.n && <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 text-[11px] text-white">{d.n}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === 'everyone' && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ key: 'all', name: 'Everyone' }, ...people, { key: 'none', name: 'Unassigned' }].map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPersonKey(p.key)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors',
                personKey === p.key ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {chipDefs.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(chip === c.key ? null : c.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
              chip === c.key ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted',
              c.key === 'overdue' && c.n > 0 && 'border-red-300 text-red-700'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', c.dot)} />
            {c.n} {c.label}
          </button>
        ))}
        {chip && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setChip(null)}>
            Clear
          </Button>
        )}
      </div>

      {tab === 'everyone' && personKey === 'all' && !chip && <PersonProgress people={people} tasks={allTasks} />}

      {/* Task list */}
      {tasksLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : nothing ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ListTodo className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              {tab === 'approval' ? 'Nothing is waiting for approval' : tab === 'mine' ? 'Nothing assigned to you' : 'No tasks here'}
            </p>
            <Button variant="link" asChild className="mt-2">
              <Link href="/tasks/new">Create a task</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const items = groups[g.key]
            if (items.length === 0) return null
            const collapsible = g.key === 'closed'
            const open = !collapsible || closedOpen
            return (
              <section key={g.key}>
                <button
                  type="button"
                  disabled={!collapsible}
                  onClick={() => collapsible && setShowClosed((v) => !v)}
                  className={cn('mb-2 flex items-center gap-1 text-sm font-semibold', g.tone, collapsible && 'hover:text-foreground')}
                >
                  {collapsible && (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                  {g.label}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{items.length}</span>
                </button>
                {open && <div className="space-y-2">{items.map(renderRow)}</div>}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
