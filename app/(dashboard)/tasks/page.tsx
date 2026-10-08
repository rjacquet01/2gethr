'use client'

import { formatCategory } from '@/lib/categories'
import { useState } from 'react'
import { useFamilies } from '@/hooks/use-family'
import { useTasks, updateTask } from '@/hooks/use-tasks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ListTodo } from 'lucide-react'
import { Plus } from 'lucide-react'
import { Calendar } from 'lucide-react'
import { Check } from 'lucide-react'
import { X } from 'lucide-react'
import { Play } from 'lucide-react'
import { Pause } from 'lucide-react'
import { RefreshCw } from 'lucide-react'
import { CheckCircle2 } from 'lucide-react'
import { Clock } from 'lucide-react'
import { AlertCircle } from 'lucide-react'
import { CircleDot } from 'lucide-react'
import { Star } from 'lucide-react'
import { MoreHorizontal } from 'lucide-react'
import { Archive } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFavorites } from '@/components/favorites-dropdown'
import Link from 'next/link'
import { toast } from 'sonner'
import { format, parseISO, isPast } from 'date-fns'

export default function TasksPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  const [statusFilter, setStatusFilter] = useState<string>('all')
  
  // Fetch ALL tasks for status counts (always without filter)
  const { tasks: allTasksRaw, isLoading: allTasksLoading, mutate: mutateAll } = useTasks(primaryFamily?.id)
  
  // Fetch filtered tasks for display
  const { tasks: filteredTasksRaw, isLoading: filteredLoading, mutate: mutateFiltered } = useTasks(
    primaryFamily?.id, 
    statusFilter === 'all' ? undefined : statusFilter
  )
  
  // Filter out archived tasks from all views
  const allTasks = allTasksRaw.filter(t => t.status?.toLowerCase() !== 'archived')
  const filteredTasks = filteredTasksRaw.filter(t => t.status?.toLowerCase() !== 'archived')
  
  // Use filtered tasks for display, all tasks for counts
  const tasks = statusFilter === 'all' ? allTasks : filteredTasks
  const tasksLoading = statusFilter === 'all' ? allTasksLoading : filteredLoading
  
  // Mutate both on actions
  const mutate = () => {
    mutateAll()
    mutateFiltered()
  }
  
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null)
  const { isFavorite, toggleFavorite } = useFavorites()

  const handleTaskAction = async (taskId: string, action: 'start' | 'complete' | 'approve' | 'reject' | 'hold' | 'resume' | 'pending' | 'cancel') => {
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
      }
      toast.success(messages[action] || 'Task updated')
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
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  // Group ALL tasks by status for counts (not filtered tasks)
  // Status in DB is uppercase (PENDING, IN_PROGRESS, etc.) so we normalize to lowercase
  const pendingCount = allTasks.filter(t => t.status?.toLowerCase() === 'pending').length
  const inProgressCount = allTasks.filter(t => t.status?.toLowerCase() === 'in_progress').length
  const awaitingApprovalCount = allTasks.filter(t => t.status?.toLowerCase() === 'pending_approval').length
  const completedCount = allTasks.filter(t => t.status?.toLowerCase() === 'completed').length

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
        <Empty
          title="No family yet"
          description="Create or join a family to start managing tasks"
        />
        <Button asChild className="mt-6">
          <Link href="/onboarding">Get Started</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground">{primaryFamily.name}</p>
        </div>
        <Button asChild size="sm" className="self-start sm:self-auto">
          <Link href="/tasks/new">
            <Plus className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="text-sm">New Task</span>
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card className={`cursor-pointer transition-colors ${statusFilter === 'pending' ? 'border-primary ring-1 ring-primary' : 'hover:border-primary'}`} onClick={() => setStatusFilter('pending')}>
          <CardContent className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 p-3 sm:p-4">
            <Clock className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground" />
            <div className="text-center sm:text-left">
              <p className="text-xl sm:text-2xl font-bold">{pendingCount}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${statusFilter === 'in_progress' ? 'border-blue-500 ring-1 ring-blue-500' : 'hover:border-blue-500'}`} onClick={() => setStatusFilter('in_progress')}>
          <CardContent className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 p-3 sm:p-4">
            <CircleDot className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
            <div className="text-center sm:text-left">
              <p className="text-xl sm:text-2xl font-bold">{inProgressCount}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${statusFilter === 'pending_approval' ? 'border-orange-500 ring-1 ring-orange-500' : 'hover:border-orange-500'}`} onClick={() => setStatusFilter('pending_approval')}>
          <CardContent className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 p-3 sm:p-4">
            <AlertCircle className="w-6 h-6 sm:w-8 sm:h-8 text-orange-500" />
            <div className="text-center sm:text-left">
              <p className="text-xl sm:text-2xl font-bold">{awaitingApprovalCount}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">Approval</p>
            </div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${statusFilter === 'completed' ? 'border-green-500 ring-1 ring-green-500' : 'hover:border-green-500'}`} onClick={() => setStatusFilter('completed')}>
          <CardContent className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 p-3 sm:p-4">
            <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8 text-green-500" />
            <div className="text-center sm:text-left">
              <p className="text-xl sm:text-2xl font-bold">{completedCount}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">Completed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 sm:gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] sm:w-[180px]">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="pending_approval">Approval</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter !== 'all' && (
          <Button variant="ghost" size="sm" onClick={() => setStatusFilter('all')}>
            Clear
          </Button>
        )}
      </div>

      {/* Task List */}
      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter === 'all' ? 'All Tasks' : `${statusFilter.replace('_', ' ')} Tasks`}
          </CardTitle>
          <CardDescription>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasksLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12">
              <ListTodo className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">
                {statusFilter === 'all' ? 'No tasks yet' : `No ${statusFilter.replace('_', ' ')} tasks`}
              </p>
              <Button variant="link" asChild className="mt-2">
                <Link href="/tasks/new">Create a task</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => {
                const assigneeName = task.child_display_name
                  ? task.child_display_name
                  : task.assignee_first_name
                    ? `${task.assignee_first_name} ${task.assignee_last_name || ''}`.trim()
                    : 'Unassigned'

                // Prefer the child's own avatar, then the assigned family member's
                // profile photo (served through the private-blob proxy endpoint),
                // falling back to initials when no picture is set.
                const assigneeAvatarSrc = task.child_avatar_url
                  ? task.child_avatar_url
                  : task.assigned_to_id && task.assignee_profile_photo_path
                    ? `/api/avatar/${task.assigned_to_id}`
                    : undefined
                const assigneeInitials = assigneeName === 'Unassigned'
                  ? '?'
                  : assigneeName.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?'

                const isOverdue = task.due_date && isPast(parseISO(task.due_date)) && task.status !== 'completed'

                return (
                  <div
                    key={task.id}
                    className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border transition-colors ${
                      task.status === 'pending_approval'
                        ? 'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20'
                        : isOverdue
                          ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
                          : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    {/* Title + metadata. Stacks full-width above the action row on
                        narrow phones instead of sharing a row with it, which is what
                        was causing the title/assignee/due-date text to overlap the
                        status badge and buttons in portrait mode. */}
                    <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                      <div className={`w-1 self-stretch sm:h-16 rounded-full shrink-0 ${getStatusBarColor(task.status, isOverdue)}`} />

                      <div className="flex-1 min-w-0">
                        <Link href={`/tasks/${task.id}`} className="hover:underline">
                          <p className="font-medium text-foreground truncate">{task.title}</p>
                        </Link>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Avatar className="w-4 h-4">
                              {assigneeAvatarSrc && <AvatarImage src={assigneeAvatarSrc} alt={assigneeName} />}
                              <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                {assigneeInitials}
                              </AvatarFallback>
                            </Avatar>
                            {assigneeName}
                          </span>
                          {task.due_date && (
                            <span className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                              <Calendar className="w-3 h-3" />
                              {isOverdue ? 'Overdue: ' : 'Due: '}
                              {format(parseISO(task.due_date), 'MMM d')}
                            </span>
                          )}
                          {task.category && (
                            <Badge variant="outline" className="text-xs">{formatCategory(task.category)}</Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => toggleFavorite('task', task.id)}
                      >
                        <Star
                          className={`w-4 h-4 ${isFavorite('task', task.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
                        />
                      </Button>
                      {getStatusBadge(task.status)}

                      {task.status === 'pending_approval' && (
                        <div className="flex gap-1">
                          <Button 
                            size="sm" 
                            variant="ghost"
                            className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-100"
                            onClick={() => handleTaskAction(task.id, 'approve')}
                            disabled={processingTaskId === task.id}
                          >
                            {processingTaskId === task.id ? <Spinner className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost"
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-100"
                            onClick={() => handleTaskAction(task.id, 'reject')}
                            disabled={processingTaskId === task.id}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )}

                      {/* Status action dropdown for all tasks */}
                      {task.status?.toLowerCase() !== 'pending_approval' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" disabled={processingTaskId === task.id}>
                              {processingTaskId === task.id ? (
                                <Spinner className="w-4 h-4" />
                              ) : (
                                <>
                                  <MoreHorizontal className="w-4 h-4 mr-1" />
                                  Status
                                </>
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {task.status?.toLowerCase() !== 'pending' && (
                              <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'pending')}>
                                <Clock className="w-4 h-4 mr-2 text-muted-foreground" />
                                Pending
                              </DropdownMenuItem>
                            )}
                            {task.status?.toLowerCase() !== 'in_progress' && (
                              <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'start')}>
                                <Play className="w-4 h-4 mr-2 text-blue-500" />
                                Start (In Progress)
                              </DropdownMenuItem>
                            )}
                            {task.status?.toLowerCase() !== 'on_hold' && (
                              <DropdownMenuItem onClick={() => handleTaskAction(task.id, 'hold')}>
                                <Pause className="w-4 h-4 mr-2 text-yellow-500" />
                                Hold
                              </DropdownMenuItem>
                            )}
                            {task.status?.toLowerCase() !== 'completed' && (
                              <DropdownMenuItem 
                                onClick={() => handleTaskAction(task.id, 'complete')}
                                className="text-green-600"
                              >
                                <Check className="w-4 h-4 mr-2" />
                                Complete
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {task.status?.toLowerCase() !== 'cancelled' && (
                              <DropdownMenuItem 
                                onClick={() => handleTaskAction(task.id, 'cancel')}
                                className="text-red-600"
                              >
                                <X className="w-4 h-4 mr-2" />
                                Cancelled
                              </DropdownMenuItem>
                            )}
                            {(task.status?.toLowerCase() === 'completed' || task.status?.toLowerCase() === 'cancelled') && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleTaskAction(task.id, 'archive')}
                                  className="text-muted-foreground"
                                >
                                  <Archive className="w-4 h-4 mr-2" />
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
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
