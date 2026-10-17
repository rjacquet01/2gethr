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
import { authFetch, useAuth } from '@/hooks/use-auth'
import { useMyRole } from '@/hooks/use-my-role'
import { Bell } from 'lucide-react'
import { ComingUp, DashboardMiniMap, FloatingEmergencyButton } from '@/components/dashboard-extras'
import {
  FamilyStatusStrip,
  AttentionBanner,
  TodayTimeline,
  TaskProgress,
  DashboardActivityPanel,
  DashboardShortcuts,
} from '@/components/dashboard-widgets'

export default function DashboardPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  // Guests get calendar and tasks only: no family map, activity or SOS.
  const { isGuest, isSupervisor } = useMyRole()
  const { user } = useAuth()
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

  // Reminders for the family being viewed only (the switcher's choice).
  const fetchReminders = useCallback(async () => {
    if (!primaryFamily?.id) return
    try {
      const res = await authFetch(`/api/reminders?status=PENDING&familyId=${encodeURIComponent(primaryFamily.id)}`)
      if (res.ok) {
        const data = await res.json()
        setReminders((data.data || []).slice(0, 5))
      }
    } catch (err) {
      console.error('Failed to fetch reminders:', err)
    } finally {
      setRemindersLoading(false)
    }
  }, [primaryFamily?.id])

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

      {/* Needs-attention banner (hidden when nothing is due) */}
      <AttentionBanner
        overdueTasks={overdueCount}
        approvals={pendingApprovalTasks.length}
        overdueReminders={reminders.filter((r) => isPast(parseISO(r.remind_at))).length}
      />

      {/* Who is where right now */}
      {!isGuest && (
        <FamilyStatusStrip
          familyId={primaryFamily.id}
          members={familyMembers}
          currentUserId={user?.id}
          showAccountStatus={isSupervisor}
        />
      )}

      {/* Two-column layout: main content left, family activity right (stacks on phones) */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3 lg:items-start">
      <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
      <TodayTimeline
        events={events.filter((e) => e.status !== 'CANCELLED' && e.status !== 'REJECTED')}
        reminders={reminders}
        tasks={tasks}
        loading={eventsLoading || tasksLoading || remindersLoading}
      />

      <TaskProgress counts={taskStatusCounts} overdue={overdueCount} />

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
                  Unlock geofence alerts, more places and more
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

      <ComingUp
        events={events}
        reminders={reminders}
        tasks={tasks}
        loading={eventsLoading || tasksLoading || remindersLoading}
      />
      </div>

      <div className="space-y-4 sm:space-y-6">
        {!isGuest && <DashboardMiniMap familyId={primaryFamily.id} />}
        {!isGuest && <DashboardActivityPanel familyId={primaryFamily.id} />}
        <DashboardShortcuts hideFamilyOnly={isGuest} />
      </div>
      </div>
      {!isGuest && <FloatingEmergencyButton familyId={primaryFamily.id} />}
    </div>
  )
}
