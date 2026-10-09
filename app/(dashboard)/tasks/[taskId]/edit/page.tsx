'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useFamilies } from '@/hooks/use-family'
import { useTask, updateTask } from '@/hooks/use-tasks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CategoryPicker } from '@/components/category-picker'
import { NotificationChannelsPicker, type NotificationChannelValue } from '@/components/notification-channels-picker'
import { cleanCustomCategory } from '@/lib/categories'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { ArrowLeft, ListTodo, Save } from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

export default function EditTaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params)
  const router = useRouter()
  const { families, isLoading: familiesLoading } = useFamilies()
  const { task, isLoading: taskLoading, mutate } = useTask(taskId)
  const primaryFamily = families[0]
  
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedToUserId, setAssignedToUserId] = useState<string>('')
  const [assignedToChildId, setAssignedToChildId] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [category, setCategory] = useState<string>('general')
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrenceRule, setRecurrenceRule] = useState<string>('daily')
  const [submitting, setSubmitting] = useState(false)
  const [notifyChannels, setNotifyChannels] = useState<NotificationChannelValue[]>([])

  // Populate form when task loads
  useEffect(() => {
    if (task) {
      setTitle(task.title || '')
      setDescription(task.description || '')
      setAssignedToUserId(task.assigned_to_id || '')
      setAssignedToChildId(task.child_profile_id || '')
      setPriority(task.priority?.toLowerCase() || 'medium')
      setCategory(task.category?.toLowerCase() || 'general')
      setRequiresApproval(task.requires_approval || false)
      setIsRecurring(task.is_recurring || false)
      setRecurrenceRule(task.recurrence_rule || 'daily')
      setNotifyChannels(((task as unknown as { notify_channels?: NotificationChannelValue[] | null }).notify_channels) || [])
      
      if (task.due_date) {
        const dueDateTime = parseISO(task.due_date)
        setDueDate(format(dueDateTime, 'yyyy-MM-dd'))
        setDueTime(format(dueDateTime, 'HH:mm'))
      }
    }
  }, [task])

  // Combine members and children for assignment
  const members = primaryFamily?.members || []
  const allChildren = members.flatMap(m => m.children || [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) {
      toast.error('Task title is required')
      return
    }

    setSubmitting(true)
    try {
      // Build due date with time if provided
      let fullDueDate = null
      if (dueDate) {
        fullDueDate = dueTime 
          ? new Date(`${dueDate}T${dueTime}`).toISOString()
          : new Date(`${dueDate}T23:59:59`).toISOString()
      }

      await updateTask(taskId, 'update', {
        title: title.trim(),
        description: description.trim() || null,
        assignedToUserId: assignedToUserId || null,
        assignedToChildId: assignedToChildId || null,
        dueDate: fullDueDate,
        priority: priority.toUpperCase(),
        category: cleanCustomCategory(category).toUpperCase() || 'GENERAL',
        requiresApproval,
        isRecurring,
        recurrenceRule: isRecurring ? recurrenceRule : null,
        notifyChannels,
      })

      toast.success('Task updated successfully')
      mutate()
      router.push(`/tasks/${taskId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update task')
    } finally {
      setSubmitting(false)
    }
  }

  if (familiesLoading || taskLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  if (!task) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Task not found</p>
        <Button asChild className="mt-4">
          <Link href="/tasks">Back to Tasks</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto pb-20 lg:pb-0">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/tasks/${taskId}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Edit Task</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="w-5 h-5" />
            Task Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Task Title *</Label>
              <Input
                id="title"
                placeholder="Enter task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Add task description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Assignment */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Assign to Member</Label>
                <Select value={assignedToUserId} onValueChange={(val) => {
                  setAssignedToUserId(val === 'none' ? '' : val)
                  if (val !== 'none') setAssignedToChildId('')
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Or Assign to Child</Label>
                <Select value={assignedToChildId} onValueChange={(val) => {
                  setAssignedToChildId(val === 'none' ? '' : val)
                  if (val !== 'none') setAssignedToUserId('')
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select child" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allChildren.map((child) => (
                      <SelectItem key={child.id} value={child.id}>
                        {child.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Due Date */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dueTime">Due Time</Label>
                <Input
                  id="dueTime"
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </div>
            </div>

            {/* Priority and Category */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <CategoryPicker
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: 'general', label: 'General' },
                    { value: 'chore', label: 'Chore' },
                    { value: 'chores', label: 'Chores' },
                    { value: 'homework', label: 'Homework' },
                    { value: 'health', label: 'Health' },
                    { value: 'errand', label: 'Errand' },
                    { value: 'errands', label: 'Errands' },
                    { value: 'self-care', label: 'Self Care' },
                    { value: 'appointment', label: 'Appointment' },
                    { value: 'other', label: 'Other' },
                  ]}
                />
              </div>
            </div>

            {/* Notification Channels */}
            <NotificationChannelsPicker
              selected={notifyChannels}
              onChange={setNotifyChannels}
              label="Notify assignee via"
              helpText="Leave unchecked to use the assignee's own notification settings."
            />

            {/* Requires Approval */}
            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div>
                <Label htmlFor="requires-approval">Require Approval</Label>
                <p className="text-sm text-muted-foreground">
                  Task must be approved by a parent when complete
                </p>
              </div>
              <Switch
                id="requires-approval"
                checked={requiresApproval}
                onCheckedChange={setRequiresApproval}
              />
            </div>

            {/* Recurring */}
            <div className="space-y-4 p-4 rounded-lg border">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="is-recurring">Recurring Task</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically repeat this task
                  </p>
                </div>
                <Switch
                  id="is-recurring"
                  checked={isRecurring}
                  onCheckedChange={setIsRecurring}
                />
              </div>
              {isRecurring && (
                <div className="space-y-2 pt-2 border-t">
                  <Label>Repeat</Label>
                  <Select value={recurrenceRule} onValueChange={setRecurrenceRule}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="weekdays">Weekdays (Mon-Fri)</SelectItem>
                      <SelectItem value="weekends">Weekends (Sat-Sun)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" asChild className="flex-1">
                <Link href={`/tasks/${taskId}`}>Cancel</Link>
              </Button>
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? <Spinner className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
