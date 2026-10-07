'use client'

import { useFamilies } from '@/hooks/use-family'
import { useEvents } from '@/hooks/use-events'

import { useSubscription } from '@/hooks/use-subscription'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import { useTasks, updateTask } from '@/hooks/use-tasks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/ui/empty'
import Link from 'next/link'
import { 
  Calendar, 
  Users, 
 
  Clock, 
  CheckCircle2,
  AlertCircle,
  Plus,
  ArrowRight,
  Crown,
  MapPin,
  Check,
  X,
  Trash2,
  ListTodo,
  CircleDot,
  Pause,
  Play
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { useState, useEffect, useCallback } from 'react'
import { format, isToday, isTomorrow, parseISO, isPast } from 'date-fns'
import { authFetch } from '@/hooks/use-auth'
import { Bell } from 'lucide-react'

export default function DashboardPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  // Only fetch events when we have a valid family ID
  // Start from today and get next 7 days
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sevenDaysLater = new Date(today)
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)
  
  const { events, isLoading: eventsLoading } = useEvents(
    primaryFamily?.id ? {
      familyId: primaryFamily.id,
      startDate: today.toISOString(),
      endDate: sevenDaysLater.toISOString(),
    } : {}
  )


  const { access } = useSubscription(primaryFamily?.id || null)
  const purchaseUi = usePurchaseUi()
  const { tasks, isLoading: tasksLoading, mutate: mutateTasks } = useTasks(primaryFamily?.id)
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null)

  // Standalone reminders (not tied to a task or event) - shown as their own
  // card below Upcoming Tasks, same "pending items at a glance" pattern.
  interface ReminderSummary {
    id: string
    title: string
    remind_at: string
    is_recurring: boolean
  }
  const [reminders, setReminders] = useState<ReminderSummary[]>([])
  const [remindersLoading, setRemindersLoading] = useState(true)

  const fetchReminders = useCallback(async () => {
    try {
      const res = await authFetch('/api/reminders?status=PENDING')
      if (res.ok) {
        const data = await res.json()
        setReminders((data.data || []).slice(0, 5))
      }
    } catch (err) {
      console.error('Failed to fetch reminders:', err)
    } finally {
      setRemindersLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReminders()
  }, [fetchReminders])

  // Helper to check if a task is past due
  const isPastDue = (t: { dueDate?: string; due_date?: string }) => {
    const dueDateStr = t.dueDate || t.due_date
    if (!dueDateStr) return false
    const dueDate = new Date(dueDateStr)
    dueDate.setHours(23, 59, 59, 999) // End of due date day
    return dueDate < new Date()
  }

  // Get pending/in-progress tasks including overdue ones
  const upcomingTasks = tasks
    .filter(t => {
      const isPendingOrInProgress = t.status?.toLowerCase() === 'pending' || t.status?.toLowerCase() === 'in_progress' || t.status?.toLowerCase() === 'pending_approval'
      return isPendingOrInProgress
    })
    .sort((a, b) => {
      // Sort overdue tasks first, then by due date
      const aOverdue = isPastDue(a)
      const bOverdue = isPastDue(b)
      if (aOverdue && !bOverdue) return -1
      if (!aOverdue && bOverdue) return 1
      // Then sort by due date
      const aDate = a.dueDate || a.due_date
      const bDate = b.dueDate || b.due_date
      if (aDate && bDate) return new Date(aDate).getTime() - new Date(bDate).getTime()
      if (aDate) return -1
      if (bDate) return 1
      return 0
    })
    .slice(0, 5)
  
  // Count overdue tasks
  const overdueCount = tasks.filter(t => {
    const isPendingOrInProgress = t.status?.toLowerCase() === 'pending' || t.status?.toLowerCase() === 'in_progress'
    return isPendingOrInProgress && isPastDue(t)
  }).length
  
  // Get tasks pending approval (for parents) - exclude past due
  const pendingApprovalTasks = tasks.filter(t => {
    if (t.status?.toLowerCase() !== 'pending_approval') return false
    if (t.dueDate) {
      const dueDate = new Date(t.dueDate)
      dueDate.setHours(23, 59, 59, 999)
      return dueDate >= new Date()
    }
    return true
  })
  
  // Helper to check if task is not past due
  const isNotPastDue = (t: { dueDate?: string }) => {
    if (!t.dueDate) return true
    const dueDate = new Date(t.dueDate)
    dueDate.setHours(23, 59, 59, 999)
    return dueDate >= new Date()
  }
  
  // Task status counts for dashboard bubbles - exclude past due tasks
  const taskStatusCounts = {
    pending: tasks.filter(t => t.status?.toLowerCase() === 'pending' && isNotPastDue(t)).length,
    inProgress: tasks.filter(t => t.status?.toLowerCase() === 'in_progress' && isNotPastDue(t)).length,
    onHold: tasks.filter(t => t.status?.toLowerCase() === 'on_hold' && isNotPastDue(t)).length,
    completed: tasks.filter(t => t.status?.toLowerCase() === 'completed').length, // Completed tasks always show
  }

  // Show approved, active, and pending events (pending events are awaiting approval)
  const upcomingEvents = events
    .filter(e => e.status !== 'CANCELLED' && e.status !== 'REJECTED')
    .slice(0, 5)

  const formatEventDate = (dateStr: string) => {
    const date = parseISO(dateStr)
    if (isToday(date)) return 'Today'
    if (isTomorrow(date)) return 'Tomorrow'
    return format(date, 'EEE, MMM d')
  }

  const handleTaskAction = async (taskId: string, action: 'start' | 'complete' | 'approve' | 'reject', e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setProcessingTaskId(taskId)
    try {
      await updateTask(taskId, action)
      mutateTasks()
      toast.success(action === 'approve' ? 'Task approved' : action === 'reject' ? 'Task rejected' : action === 'start' ? 'Task started' : 'Task completed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update task')
    } finally {
      setProcessingTaskId(null)
    }
  }

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      urgent: 'bg-red-500',
      high: 'bg-orange-500',
      medium: 'bg-yellow-500',
      low: 'bg-green-500',
    }
    return colors[priority] || colors.medium
  }

  // Get status bar color based on task status
  const getStatusBarColor = (status: string, isOverdue: boolean) => {
    if (isOverdue) return 'bg-red-500'
    const normalizedStatus = status?.toLowerCase()
    switch (normalizedStatus) {
      case 'in_progress': return 'bg-blue-500'
      case 'on_hold': return 'bg-yellow-500'
      case 'completed': return 'bg-green-500'
      case 'pending_approval': return 'bg-orange-500'
      case 'cancelled': return 'bg-gray-500'
      default: return 'bg-gray-400' // pending
    }
  }

  const getStatusBadge = (status: string) => {
    const normalizedStatus = status?.toLowerCase()
    switch (normalizedStatus) {
      case 'pending': return <Badge variant="secondary">Pending</Badge>
      case 'in_progress': return <Badge className="bg-blue-500 text-white">In Progress</Badge>
      case 'pending_approval': return <Badge className="bg-orange-500 text-white">Awaiting Approval</Badge>
      case 'completed': return <Badge className="bg-green-500 text-white">Completed</Badge>
      case 'on_hold': return <Badge className="bg-yellow-500 text-white">On Hold</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      SCHOOL: 'bg-blue-500',
      SPORTS: 'bg-green-500',
      MEDICAL: 'bg-red-500',
      SOCIAL: 'bg-purple-500',
      WORK: 'bg-orange-500',
      OTHER: 'bg-gray-500',
    }
    return colors[category] || colors.OTHER
  }

  if (familiesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  // Members shown as a facepile on the Family bubble card (limit avoids the
  // card overflowing when a family has many members; the rest collapse into
  // a "+N" bubble).
  const familyMembers = primaryFamily?.members || []
  const visibleFamilyMembers = familyMembers.slice(0, 3)
  const extraFamilyMemberCount = familyMembers.length - visibleFamilyMembers.length

  if (!primaryFamily) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Empty
          title="No family yet"
          description="Create or join a family to start coordinating"
        />
        <div className="flex gap-3 mt-6">
          <Button asChild>
            <Link href="/onboarding">Get Started</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Home</h1>
          <p className="text-sm text-muted-foreground">{primaryFamily.name}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 py-1">
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/calendar">
              <Calendar className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Calendar</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/calendar/new">
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Event</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/dashboard/reminders?new=1">
              <Bell className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Reminder</span>
            </Link>
          </Button>
          <Button size="sm" asChild className="shrink-0">
            <Link href="/tasks/new">
              <ListTodo className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">New Task</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 grid-cols-2">
        <Link href="/family">
          <Card className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50 active:scale-[0.98]">
            <CardContent className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 p-3 sm:p-6">
              {/* Facepile of member profile photos instead of a generic icon.
                  Capped at 3 avatars + a "+N" bubble so it stays legible in
                  this small card; falls back to initials (matching the
                  Family page) for members without a photo, and to the Users
                  icon if the family somehow has no members. */}
              <div className="flex items-center -space-x-2 sm:-space-x-3 shrink-0">
                {visibleFamilyMembers.length > 0 ? (
                  visibleFamilyMembers.map((member) => {
                    const initials = member.displayName
                      ?.split(' ')
                      .map(n => n[0])
                      .join('')
                      .toUpperCase() || '?'
                    return (
                      <Avatar
                        key={member.id}
                        className="w-9 h-9 sm:w-11 sm:h-11 border-2 border-background"
                      >
                        <AvatarImage
                          src={member.avatarUrl ? `/api/files?pathname=${encodeURIComponent(member.avatarUrl)}` : undefined}
                          alt={member.displayName}
                        />
                        <AvatarFallback className="text-xs sm:text-sm bg-primary/10 text-primary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                    )
                  })
                ) : (
                  <div className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-primary/10 text-primary border-2 border-background">
                    <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                )}
                {extraFamilyMemberCount > 0 && (
                  <div className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-muted text-muted-foreground text-xs sm:text-sm font-medium border-2 border-background">
                    +{extraFamilyMemberCount}
                  </div>
                )}
              </div>
              <div className="text-center sm:text-left">
                <p className="text-xl sm:text-2xl font-bold">{primaryFamily.members?.length || 0}</p>
                <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight">Family</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/upcoming-events">
          <Card className="cursor-pointer transition-all hover:shadow-md hover:border-blue-500/50 active:scale-[0.98]">
            <CardContent className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 p-3 sm:p-6">
              <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 text-blue-500">
                <Calendar className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="text-center sm:text-left">
                <p className="text-xl sm:text-2xl font-bold">{upcomingEvents.length}</p>
                <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight">Events</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Task Status Overview Bubbles */}
      <div>
        <h2 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">Task Status</h2>
        <div className="grid gap-2 sm:gap-3 grid-cols-4">
          <Link href="/tasks?status=pending">
            <Card className="cursor-pointer transition-all hover:shadow-md hover:border-muted-foreground/50 active:scale-[0.98]">
              <CardContent className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 p-2 sm:p-4">
                <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-muted text-muted-foreground">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-lg sm:text-xl font-bold">{taskStatusCounts.pending}</p>
                  <p className="text-[9px] sm:text-xs text-muted-foreground">Pending</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/tasks?status=in_progress">
            <Card className="cursor-pointer transition-all hover:shadow-md hover:border-blue-500/50 active:scale-[0.98]">
              <CardContent className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 p-2 sm:p-4">
                <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500/10 text-blue-500">
                  <Play className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-lg sm:text-xl font-bold">{taskStatusCounts.inProgress}</p>
                  <p className="text-[9px] sm:text-xs text-muted-foreground">Active</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/tasks?status=on_hold">
            <Card className="cursor-pointer transition-all hover:shadow-md hover:border-yellow-500/50 active:scale-[0.98]">
              <CardContent className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 p-2 sm:p-4">
                <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-yellow-500/10 text-yellow-500">
                  <Pause className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-lg sm:text-xl font-bold">{taskStatusCounts.onHold}</p>
                  <p className="text-[9px] sm:text-xs text-muted-foreground">Hold</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/tasks?status=completed">
            <Card className="cursor-pointer transition-all hover:shadow-md hover:border-green-500/50 active:scale-[0.98]">
              <CardContent className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 p-2 sm:p-4">
                <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/10 text-green-500">
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-lg sm:text-xl font-bold">{taskStatusCounts.completed}</p>
                  <p className="text-[9px] sm:text-xs text-muted-foreground">Done</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Premium Banner */}
      {!access.hasPremium && purchaseUi.canPurchase && (
        <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 sm:p-6">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary text-primary-foreground shrink-0">
                <Crown className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm sm:text-base">Upgrade to Premium</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Unlock location sharing and more
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link href="/subscription">
                Upgrade
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Tasks Section */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Upcoming Tasks</CardTitle>
            <CardDescription>Tasks assigned to family members</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {overdueCount > 0 && (
              <Badge variant="destructive" className="bg-red-500 text-white">
                {overdueCount} overdue
              </Badge>
            )}
            {pendingApprovalTasks.length > 0 && (
              <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                {pendingApprovalTasks.length} awaiting approval
              </Badge>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tasks">
                View all
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tasksLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : upcomingTasks.length === 0 ? (
            <div className="text-center py-8">
              <ListTodo className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No pending tasks</p>
              <Button variant="link" asChild className="mt-2">
                <Link href="/tasks/new">Create a task</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingTasks.map((task) => {
                const taskOverdue = isPastDue(task)
                const taskAssigneeName = task.child_display_name
                  ? task.child_display_name
                  : task.assignee_first_name
                    ? `${task.assignee_first_name} ${task.assignee_last_name || ''}`.trim()
                    : 'Unassigned'
                const taskAssigneeAvatarSrc = task.child_avatar_url
                  ? task.child_avatar_url
                  : task.assigned_to_id && task.assignee_profile_photo_path
                    ? `/api/avatar/${task.assigned_to_id}`
                    : undefined
                const taskAssigneeInitials = taskAssigneeName === 'Unassigned'
                  ? '?'
                  : taskAssigneeName.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?'
                return (
                <div
                  key={task.id}
                  className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border transition-colors ${
                    taskOverdue
                      ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
                      : task.status?.toLowerCase() === 'pending_approval'
                        ? 'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20'
                        : 'border-border hover:bg-muted/50'
                  }`}
                >
                  {/* Title + metadata stacks full-width above the action row on narrow
                      phones instead of sharing a row with it, matching the fix used for
                      task-card text overlap in mobile portrait mode. */}
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    <div className={`w-1 self-stretch sm:h-12 rounded-full shrink-0 ${getStatusBarColor(task.status, taskOverdue)}`} />
                    <div className="flex-1 min-w-0">
                      <Link href={`/tasks/${task.id}`} className="hover:underline">
                        <p className={`font-medium truncate ${taskOverdue ? 'text-red-700 dark:text-red-400' : 'text-foreground'}`}>{task.title}</p>
                      </Link>
                      <div className={`flex items-center gap-2 text-xs flex-wrap ${taskOverdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                        {taskOverdue && <AlertCircle className="w-3 h-3" />}
                        <Avatar className="w-4 h-4">
                          {taskAssigneeAvatarSrc && <AvatarImage src={taskAssigneeAvatarSrc} alt={taskAssigneeName} />}
                          <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                            {taskAssigneeInitials}
                          </AvatarFallback>
                        </Avatar>
                        <span>{taskAssigneeName}</span>
                        {task.due_date && (
                          <>
                            <span>|</span>
                            <span className={taskOverdue ? 'font-semibold' : ''}>
                              {taskOverdue ? 'OVERDUE - ' : 'Due '}{format(parseISO(task.due_date), 'MMM d')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {task.status?.toLowerCase() === 'pending_approval' ? (
                    <div className="flex gap-1 shrink-0">
                      <Button 
                        size="sm" 
                        variant="ghost"
                        className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-100"
                        onClick={(e) => handleTaskAction(task.id, 'approve', e)}
                        disabled={processingTaskId === task.id}
                        title="Approve"
                      >
                        {processingTaskId === task.id ? (
                          <Spinner className="w-4 h-4" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-100"
                        onClick={(e) => handleTaskAction(task.id, 'reject', e)}
                        disabled={processingTaskId === task.id}
                        title="Reject"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : task.status?.toLowerCase() === 'pending' ? (
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={(e) => handleTaskAction(task.id, 'start', e)}
                      disabled={processingTaskId === task.id}
                    >
                      {processingTaskId === task.id ? <Spinner className="w-4 h-4" /> : <CircleDot className="w-4 h-4 mr-1" />}
                      Start
                    </Button>
                  ) : task.status?.toLowerCase() === 'in_progress' ? (
                    <Button 
                      size="sm" 
                      variant="ghost"
                      className="text-green-600"
                      onClick={(e) => handleTaskAction(task.id, 'complete', e)}
                      disabled={processingTaskId === task.id}
                    >
                      {processingTaskId === task.id ? <Spinner className="w-4 h-4" /> : <Check className="w-4 h-4 mr-1" />}
                      Complete
                    </Button>
                  ) : (
                    getStatusBadge(task.status)
                  )}
                </div>
              )})}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Events Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upcoming Events</CardTitle>
          <CardDescription>Next 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : upcomingEvents.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No upcoming events in the next 7 days</p>
              <Button variant="link" asChild className="mt-2">
                <Link href="/calendar/new">Create an event</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    <div className={`w-1 self-stretch sm:h-12 rounded-full shrink-0 ${getCategoryColor(event.category)}`} />
                    <div className="flex-1 min-w-0">
                      <Link href={`/calendar/event/${event.id}`} className="hover:underline">
                        <p className="font-medium text-foreground truncate">{event.title}</p>
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <Calendar className="w-3 h-3" />
                        <span>{formatEventDate(event.startTime)}</span>
                        {!event.allDay && (
                          <>
                            <span>|</span>
                            <span>{format(parseISO(event.startTime), 'h:mm a')}</span>
                          </>
                        )}
                        {event.location && (
                          <>
                            <span>|</span>
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              <span className="truncate max-w-[150px]">{event.location}</span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0">
                    {event.allDay && (
                      <Badge variant="secondary" className="text-xs">All day</Badge>
                    )}
                    {event.status === 'PENDING' && (
                      <Badge className="bg-orange-500 text-white text-xs">Pending</Badge>
                    )}
                    {event.status === 'APPROVED' && (
                      <Badge className="bg-green-500 text-white text-xs">Confirmed</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reminders Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Reminders</CardTitle>
            <CardDescription>Quick reminders that aren&apos;t tied to a task or event</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild className="gap-1">
            <Link href="/dashboard/reminders">
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {remindersLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : reminders.length === 0 ? (
            <div className="text-center py-6">
              <Bell className="w-10 h-10 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No reminders yet</p>
              <Button variant="link" asChild className="mt-1">
                <Link href="/dashboard/reminders">Create a reminder</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {reminders.map((reminder) => {
                const due = parseISO(reminder.remind_at)
                const overdue = isPast(due)
                return (
                  <Link
                    key={reminder.id}
                    href="/dashboard/reminders"
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <Bell className={`w-4 h-4 shrink-0 ${overdue ? 'text-destructive' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{reminder.title}</p>
                      <p className={`text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {format(due, 'MMM d, h:mm a')}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
