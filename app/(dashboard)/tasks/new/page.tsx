'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFamilies, useFamily } from '@/hooks/use-family'
import { createTask } from '@/hooks/use-tasks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CategoryPicker } from '@/components/category-picker'
import { cleanCustomCategory } from '@/lib/categories'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import {
  NotificationChannelsPicker,
  type NotificationChannelValue,
} from '@/components/notification-channels-picker'
import { ArrowLeft, ListTodo } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { format } from 'date-fns'

export default function NewTaskPage() {
  const router = useRouter()
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamilyId = families[0]?.id
  
  // Fetch detailed family data including members and children
  const { family: primaryFamily, isLoading: familyLoading } = useFamily(primaryFamilyId || null)
  
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedToUserId, setAssignedToUserId] = useState<string>('')
  const [assignedToChildId, setAssignedToChildId] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [reminderAt, setReminderAt] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [category, setCategory] = useState<string>('general')
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrenceRule, setRecurrenceRule] = useState<string>('daily')
  const [notifyChannels, setNotifyChannels] = useState<NotificationChannelValue[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Get members and children from detailed family data
  const members = primaryFamily?.members || []
  const allChildren = primaryFamily?.children || []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) {
      toast.error('Task title is required')
      return
    }
    
    if (!primaryFamily?.id) {
      toast.error('No family selected')
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
      
      // Build reminder date
      let fullReminderAt = null
      if (reminderAt) {
        fullReminderAt = new Date(reminderAt).toISOString()
      }

      await createTask({
        familyId: primaryFamily.id,
        title: title.trim(),
        description: description.trim() || undefined,
        assignedToUserId: assignedToUserId || undefined,
        assignedToChildId: assignedToChildId || undefined,
        dueDate: fullDueDate || undefined,
        reminderAt: fullReminderAt || undefined,
        priority,
        requiresApproval,
        category: category === 'general' || !cleanCustomCategory(category) ? undefined : cleanCustomCategory(category),
        isRecurring,
        recurrenceRule: isRecurring ? recurrenceRule : undefined,
        notifyChannels: notifyChannels.length > 0 ? notifyChannels : undefined,
      })

      toast.success('Task created successfully')
      router.push('/dashboard')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  if (familiesLoading || familyLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  if (!primaryFamily) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Please join or create a family first</p>
        <Button asChild className="mt-4">
          <Link href="/onboarding">Get Started</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">New Task</h1>
          <p className="text-muted-foreground">Assign a task to a family member</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListTodo className="w-5 h-5" />
              Task Details
            </CardTitle>
            <CardDescription>
              Create a task and assign it to a family member or child
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Task Title *</Label>
              <Input
                id="title"
                placeholder="e.g., Clean your room, Do homework, Take out trash"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Add more details about this task..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Assignment */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Assign to Family Member</Label>
                <Select 
                  value={assignedToUserId || 'unassigned'} 
                  onValueChange={(v) => { 
                    setAssignedToUserId(v === 'unassigned' ? '' : v)
                    setAssignedToChildId('')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a member" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {members.filter(m => m.userId).map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Or Assign to Child</Label>
                <Select 
                  value={assignedToChildId || 'no-child'} 
                  onValueChange={(v) => { 
                    setAssignedToChildId(v === 'no-child' ? '' : v)
                    setAssignedToUserId('')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a child" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-child">None</SelectItem>
                    {allChildren.filter(c => c.id).map((child) => (
                      <SelectItem key={child.id} value={child.id}>
                        {child.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Due Date and Time */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  min={format(new Date(), 'yyyy-MM-dd')}
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

            {/* Reminder */}
            <div className="space-y-2">
              <Label htmlFor="reminder">Reminder</Label>
              <Input
                id="reminder"
                type="datetime-local"
                value={reminderAt}
                onChange={(e) => setReminderAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Set a reminder notification for this task</p>
            </div>

            {/* Notification Channels */}
            <NotificationChannelsPicker
              selected={notifyChannels}
              onChange={setNotifyChannels}
              label="Notify assignee via"
              helpText="Leave unchecked to use the assignee's own notification settings."
            />

            {/* Priority and Category */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
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
                    { value: 'chores', label: 'Chores' },
                    { value: 'homework', label: 'Homework' },
                    { value: 'health', label: 'Health' },
                    { value: 'errands', label: 'Errands' },
                    { value: 'self-care', label: 'Self Care' },
                    { value: 'other', label: 'Other' },
                  ]}
                />
              </div>
            </div>

            {/* Requires Approval */}
            <div className="flex items-center justify-between p-4 rounded-lg border border-border">
              <div>
                <Label htmlFor="requires-approval" className="font-medium">Require Approval</Label>
                <p className="text-sm text-muted-foreground">
                  Task must be approved by a parent when marked complete
                </p>
              </div>
              <Switch
                id="requires-approval"
                checked={requiresApproval}
                onCheckedChange={setRequiresApproval}
              />
            </div>

            {/* Recurring Task */}
            <div className="space-y-4 p-4 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="is-recurring" className="font-medium">Recurring Task</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically create this task on a schedule
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
                      <SelectValue placeholder="Select frequency" />
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

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-4 pb-safe">
              <Button type="button" variant="outline" asChild className="flex-1 h-12 touch-target">
                <Link href="/dashboard">Cancel</Link>
              </Button>
              <Button type="submit" disabled={submitting} className="flex-1 h-12 touch-target">
                {submitting && <Spinner className="w-4 h-4 mr-2" />}
                Create Task
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
