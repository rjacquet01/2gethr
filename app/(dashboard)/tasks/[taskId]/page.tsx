'use client'

import { formatCategory } from '@/lib/categories'
import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { useFamilies } from '@/hooks/use-family'
import { useTask, updateTask, deleteTask } from '@/hooks/use-tasks'
import { useMyRole } from '@/hooks/use-my-role'
import { CommentThread } from '@/components/comment-thread'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import { 
  ArrowLeft, ListTodo, User, Calendar, Clock, Check, X, Play, 
  Trash2, MessageSquare, AlertCircle, CheckCircle2, History, Edit,
  Pause, CircleOff, RotateCcw
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import Link from 'next/link'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params)
  const router = useRouter()
  const { user: currentUser } = useAuth()
  const { task, isLoading, mutate } = useTask(taskId)
  const { families } = useFamilies()
  const [processing, setProcessing] = useState(false)
  // Parents (the owner is always a parent) can delete anyone's comment.
  const { isParent } = useMyRole()

  const handleAction = async (action: 'start' | 'complete' | 'approve' | 'reject' | 'pending' | 'hold' | 'cancel') => {
    setProcessing(true)
    try {
      await updateTask(taskId, action)
      mutate()
      const messages: Record<string, string> = {
        start: 'Task started',
        complete: 'Task marked as complete',
        approve: 'Task approved',
        reject: 'Task sent back for revision',
        pending: 'Task set to pending',
        hold: 'Task put on hold',
        cancel: 'Task cancelled',
      }
      toast.success(messages[action] || 'Task updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update task')
    } finally {
      setProcessing(false)
    }
  }

  const respondAssignment = async (accept: boolean) => {
    setProcessing(true)
    try {
      await updateTask(taskId, accept ? 'accept_assignment' : 'decline_assignment')
      mutate()
      toast.success(accept ? 'Task accepted' : 'Task declined')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to respond')
    } finally {
      setProcessing(false)
    }
  }

  const handleStatusChange = (newStatus: string) => {
    const actionMap: Record<string, string> = {
      pending: 'pending',
      in_progress: 'start',
      on_hold: 'hold',
      completed: 'complete',
      cancelled: 'cancel',
    }
    const action = actionMap[newStatus]
    if (action) {
      handleAction(action as 'start' | 'complete' | 'pending' | 'hold' | 'cancel')
    }
  }

  const handleDelete = async () => {
    try {
      await deleteTask(taskId)
      toast.success('Task deleted')
      router.push('/dashboard')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete task')
    }
  }

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      urgent: 'bg-red-500 text-white',
      high: 'bg-orange-500 text-white',
      medium: 'bg-yellow-500 text-white',
      low: 'bg-green-500 text-white',
    }
    return <Badge className={styles[priority] || styles.medium}>{priority}</Badge>
  }

  const getStatusBadge = (status: string) => {
    const normalizedStatus = status?.toLowerCase()
    switch (normalizedStatus) {
      case 'pending': return <Badge variant="secondary">Pending</Badge>
      case 'in_progress': return <Badge className="bg-blue-500 text-white">In Progress</Badge>
      case 'on_hold': return <Badge className="bg-yellow-500 text-white">On Hold</Badge>
      case 'pending_approval': return <Badge className="bg-orange-500 text-white">Awaiting Approval</Badge>
      case 'completed': return <Badge className="bg-green-500 text-white">Completed</Badge>
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      created: 'Created task',
      started: 'Started task',
      completed: 'Marked as complete',
      approved: 'Approved task',
      rejected: 'Sent back for revision',
      updated: 'Updated task',
      commented: 'Added a comment',
    }
    return labels[action] || action
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  if (!task) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Task not found</p>
        <Button asChild className="mt-4">
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    )
  }

  const assigneeName = task.child_display_name 
    ? task.child_display_name
    : task.assignee_first_name 
      ? `${task.assignee_first_name} ${task.assignee_last_name || ''}`.trim()
      : 'Unassigned'

  const assignmentStatus = (task as unknown as { assignment_status?: string | null }).assignment_status || null
  // My role in THIS task's family (not the account's owned family).
  const taskFamily = families.find((f) => f.id === (task as unknown as { family_id?: string }).family_id)
  const myRole = taskFamily?.currentUserRole || taskFamily?.userRole
  const iAmAdult = myRole === 'PARENT' || myRole === 'GUARDIAN'
  const iAmAssignee = !!currentUser && task.assigned_to_id === currentUser.id
  const canRespond =
    (assignmentStatus === 'PENDING_APPROVAL' && iAmAdult && task.created_by_id !== currentUser?.id) ||
    (assignmentStatus === 'PENDING_ACCEPTANCE' && iAmAssignee)

  return (
    <div className="max-w-3xl mx-auto pb-20 lg:pb-0 space-y-6">
      {(assignmentStatus === 'PENDING_APPROVAL' || assignmentStatus === 'PENDING_ACCEPTANCE') && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
              {assignmentStatus === 'PENDING_APPROVAL'
                ? 'Waiting for a parent or guardian to approve this task.'
                : 'Waiting for the assignee to accept this task.'}
            </p>
            {canRespond && (
              <div className="flex gap-3">
                <Button onClick={() => respondAssignment(true)} disabled={processing} className="bg-green-600 hover:bg-green-700">
                  <Check className="w-4 h-4 mr-2" />{assignmentStatus === 'PENDING_APPROVAL' ? 'Approve' : 'Accept'}
                </Button>
                <Button onClick={() => respondAssignment(false)} disabled={processing} variant="outline">
                  <X className="w-4 h-4 mr-2" />Decline
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {assignmentStatus === 'DECLINED' && (
        <Card className="border-red-300"><CardContent className="pt-6 text-sm text-red-600">This task request was declined.</CardContent></Card>
      )}
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{task.title}</h1>
            {getStatusBadge(task.status)}
            {getPriorityBadge(task.priority)}
          </div>
          <p className="text-muted-foreground">{task.family_name}</p>
        </div>
      </div>

      {/* Task Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="w-5 h-5" />
            Task Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {task.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
              <p className="text-foreground">{task.description}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">
                <span className="text-muted-foreground">Assigned to:</span>{' '}
                <span className="font-medium">{assigneeName}</span>
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">
                <span className="text-muted-foreground">Created by:</span>{' '}
                <span className="font-medium">{task.creator_first_name} {task.creator_last_name}</span>
              </span>
            </div>

            {task.due_date && (
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  <span className="text-muted-foreground">Due:</span>{' '}
                  <span className="font-medium">{format(parseISO(task.due_date), 'PPP p')}</span>
                </span>
              </div>
            )}

            {task.reminder_at && (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  <span className="text-muted-foreground">Reminder:</span>{' '}
                  <span className="font-medium">{format(parseISO(task.reminder_at), 'PPP p')}</span>
                </span>
              </div>
            )}

            {task.category && (
              <div className="flex items-center gap-2">
                <ListTodo className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  <span className="text-muted-foreground">Category:</span>{' '}
                  <span className="font-medium">{formatCategory(task.category)}</span>
                </span>
              </div>
            )}

            {task.requires_approval && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium text-orange-600">Requires approval when complete</span>
              </div>
            )}
          </div>

          {task.completed_at && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900">
              <p className="text-sm text-green-700 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4 inline mr-1" />
                Completed on {format(parseISO(task.completed_at), 'PPP p')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted-foreground">Update Status</label>
            <div className="flex items-center gap-3">
              <Select 
                value={task.status?.toLowerCase()} 
                onValueChange={handleStatusChange}
                disabled={processing || task.status?.toLowerCase() === 'pending_approval'}
              >
                <SelectTrigger className="w-full sm:w-[200px]">
                  {processing ? (
                    <div className="flex items-center gap-2">
                      <Spinner className="w-4 h-4" />
                      <span>Updating...</span>
                    </div>
                  ) : (
                    <SelectValue placeholder="Select status" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      Pending
                    </div>
                  </SelectItem>
                  <SelectItem value="in_progress">
                    <div className="flex items-center gap-2">
                      <Play className="w-4 h-4 text-blue-500" />
                      Start (In Progress)
                    </div>
                  </SelectItem>
                  <SelectItem value="on_hold">
                    <div className="flex items-center gap-2">
                      <Pause className="w-4 h-4 text-yellow-500" />
                      Hold
                    </div>
                  </SelectItem>
                  <SelectItem value="completed">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      Complete
                    </div>
                  </SelectItem>
                  <SelectItem value="cancelled">
                    <div className="flex items-center gap-2">
                      <CircleOff className="w-4 h-4 text-red-500" />
                      Cancelled
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {task.status?.toLowerCase() === 'pending_approval' && (
                <span className="text-sm text-orange-600">Awaiting approval</span>
              )}
            </div>
          </div>

          {/* Approval Actions */}
          {task.status?.toLowerCase() === 'pending_approval' && (
            <div className="flex flex-wrap gap-3 pt-2 border-t">
              <Button onClick={() => handleAction('approve')} disabled={processing} className="bg-green-600 hover:bg-green-700">
                {processing ? <Spinner className="w-4 h-4 mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                Approve
              </Button>
              <Button onClick={() => handleAction('reject')} disabled={processing} variant="outline">
                {processing ? <Spinner className="w-4 h-4 mr-2" /> : <X className="w-4 h-4 mr-2" />}
                Send Back
              </Button>
            </div>
          )}

          {/* Other Actions */}
          <div className="flex flex-wrap gap-3 pt-2 border-t">
            <Button variant="outline" asChild>
              <Link href={`/tasks/${taskId}/edit`}>
                <Edit className="w-4 h-4 mr-2" />
                Edit Task
              </Link>
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Task</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this task? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Comments
          </CardTitle>
          <CardDescription>Add notes or feedback about this task</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Authors can edit their own comments (PATCH); authors and parents can delete. */}
          <CommentThread
            baseUrl={`/api/tasks/${taskId}/comments`}
            currentUserId={currentUser?.id}
            canModerate={isParent}
            editable
          />
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Activity History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {task.history && task.history.length > 0 ? (
            <div className="space-y-3">
              {task.history.map((h: { id: string; first_name: string; last_name: string; action: string; created_at: string }) => (
                <div key={h.id} className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                  <span className="font-medium">{h.first_name} {h.last_name}</span>
                  <span className="text-muted-foreground">{getActionLabel(h.action)}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {format(parseISO(h.created_at), 'MMM d, h:mm a')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
