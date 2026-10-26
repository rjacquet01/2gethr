'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { toast } from 'sonner'
import { authFetch } from '@/hooks/use-auth'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BirthdateInput, Turns18Chip, formatYmd } from '@/components/child-age'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MemberAvatar, AppearanceButton } from '@/components/member-avatar'
import { AccountStatusBadge } from '@/components/account-status-badge'
import { useMyRole } from '@/hooks/use-my-role'
import { formatCategory } from '@/lib/categories'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  ArrowLeft,
  Baby,
  Calendar,
  ListTodo,
  Clock,
  MapPin,
  GraduationCap,
  School,
  Pencil,
  Cake
} from 'lucide-react'
import Link from 'next/link'
import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns'

interface ChildProfile {
  id: string
  displayName: string
  avatarUrl: string | null
  grade: string | null
  school: string | null
  age: number | null
  birthDate: string | null
  /** YYYY-MM-DD; age is derived from it when present */
  dateOfBirth?: string | null
  turns18On?: string | null
  daysUntil18?: number | null
  /** Parents can edit the child's details */
  canEdit?: boolean
  familyId: string
  familyName: string
  familyMemberId?: string | null
  /** Has their own login; false = managed by a parent */
  hasAccount?: boolean
  color?: string | null
  emoji?: string | null
}

interface Task {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  category: string | null
}

interface Event {
  id: string
  title: string
  start_time: string
  end_time: string
  is_all_day: boolean
  location: string | null
  color: string | null
}

interface ChildData {
  profile: ChildProfile
  tasks: Task[]
  events: Event[]
}

const fetcher = async (url: string) => {
  const res = await authFetch(url)
  if (!res.ok) throw new Error('Failed to fetch')
  const data = await res.json()
  return data.data
}

const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  PENDING_APPROVAL: 'Awaiting approval',
}

function getPriorityColor(priority: string) {
  switch (priority) {
    case 'HIGH': return 'text-red-500'
    case 'MEDIUM': return 'text-yellow-500'
    case 'LOW': return 'text-green-500'
    default: return 'text-muted-foreground'
  }
}

function formatDueDate(dateStr: string | null) {
  if (!dateStr) return 'No due date'
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return 'No due date'
    return format(date, 'MMM d, yyyy')
  } catch {
    return 'No due date'
  }
}

function formatEventTime(dateStr: string, isAllDay: boolean) {
  if (isAllDay) return 'All day'
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return ''
    return format(date, 'h:mm a')
  } catch {
    return ''
  }
}

export default function ChildProfilePage({
  params,
}: {
  params: Promise<{ childId: string }>
}) {
  const { childId } = use(params)
  const router = useRouter()
  const { isSupervisor } = useMyRole()

  const { data: childData, isLoading, error, mutate } = useSWR<ChildData>(
    `/api/children/${childId}`,
    fetcher
  )

  // Edit details (parents only): name, birthdate, school, grade.
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ displayName: '', dateOfBirth: '', school: '', grade: '' })
  const openEdit = () => {
    const p = childData?.profile
    if (!p) return
    setForm({ displayName: p.displayName || '', dateOfBirth: p.dateOfBirth || '', school: p.school || '', grade: p.grade || '' })
    setEditOpen(true)
  }
  const saveEdit = async () => {
    if (!form.displayName.trim()) {
      toast.error('Please enter a name')
      return
    }
    setSaving(true)
    try {
      const res = await authFetch(`/api/children/${childId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          dateOfBirth: form.dateOfBirth || null,
          school: form.school.trim() || null,
          grade: form.grade.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not save changes')
        return
      }
      toast.success('Details saved')
      setEditOpen(false)
      mutate()
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !childData) {
    return (
      <div className="p-4 sm:p-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Empty
          title="Child not found"
          description="The child profile you're looking for doesn't exist or you don't have permission to view it."
        />
      </div>
    )
  }

  const { profile, tasks, events } = childData
  const initials = profile.displayName
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase() || '?'

  return (
    <div className="space-y-6 p-4 sm:p-6 pb-24 sm:pb-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <MemberAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} color={profile.color} emoji={profile.emoji} className="w-16 h-16 text-2xl" />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-1">
            {profile.displayName}
            {profile.familyMemberId && (
              <AppearanceButton familyId={profile.familyId} memberId={profile.familyMemberId} name={profile.displayName} avatarUrl={profile.avatarUrl} color={profile.color} emoji={profile.emoji} />
            )}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Baby className="w-3 h-3 mr-1" />
              Child
            </Badge>
            {isSupervisor && profile.hasAccount != null && (
              <AccountStatusBadge hasAccount={profile.hasAccount} showHint />
            )}
            {profile.grade && (
              <Badge variant="outline">
                <GraduationCap className="w-3 h-3 mr-1" />
                {profile.grade}
              </Badge>
            )}
            {profile.school && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <School className="w-3 h-3" />
                {profile.school}
              </span>
            )}
            {profile.age != null && (
              <Badge variant="outline">
                <Cake className="w-3 h-3 mr-1" />
                Age {profile.age}
                {profile.dateOfBirth ? ` · born ${formatYmd(profile.dateOfBirth)}` : ''}
              </Badge>
            )}
            <Turns18Chip child={{ id: profile.id, displayName: profile.displayName, turns18On: profile.turns18On, daysUntil18: profile.daysUntil18 }} />
          </div>
        </div>
        {profile.canEdit && (
          <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={openEdit}>
            <Pencil className="w-4 h-4 mr-1.5" />
            Edit
          </Button>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {profile.displayName}</DialogTitle>
            <DialogDescription>Their age is worked out from the birthdate.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="editChildName">Name</Label>
              <Input id="editChildName" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
            </div>
            <BirthdateInput id="editChildBirthdate" value={form.dateOfBirth} onChange={(v) => setForm((f) => ({ ...f, dateOfBirth: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="editChildSchool">School</Label>
                <Input id="editChildSchool" value={form.school} onChange={(e) => setForm((f) => ({ ...f, school: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editChildGrade">Grade</Label>
                <Input id="editChildGrade" value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Spinner className="w-4 h-4 mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ListTodo className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{tasks.length}</p>
                <p className="text-sm text-muted-foreground">Active Tasks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{events.length}</p>
                <p className="text-sm text-muted-foreground">Upcoming Events</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tasks & Events Tabs */}
      <Tabs defaultValue="tasks" className="w-full">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="tasks">
            <ListTodo className="w-4 h-4 mr-2" />
            Tasks
          </TabsTrigger>
          <TabsTrigger value="events">
            <Calendar className="w-4 h-4 mr-2" />
            Events
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assigned Tasks</CardTitle>
              <CardDescription>Tasks assigned to {profile.displayName}</CardDescription>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <Empty
                  title="No tasks"
                  description="No tasks have been assigned yet"
                />
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <Link
                      key={task.id}
                      href={`/tasks/${task.id}`}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className={`w-2 h-2 rounded-full ${getPriorityColor(task.priority)} bg-current flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{task.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDueDate(task.due_date)}
                          {task.category && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {formatCategory(task.category)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge 
                        variant={task.status === 'IN_PROGRESS' ? 'default' : 'secondary'}
                        className="text-xs flex-shrink-0"
                      >
                        {TASK_STATUS_LABEL[task.status.toUpperCase()] ?? formatCategory(task.status)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming Events</CardTitle>
              <CardDescription>Events {profile.displayName} is participating in</CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <Empty
                  title="No upcoming events"
                  description="No events scheduled in the next 7 days"
                />
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <Link
                      key={event.id}
                      href={`/calendar?event=${event.id}`}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div 
                        className="w-1 h-12 rounded-full flex-shrink-0"
                        style={{ backgroundColor: event.color || '#0d9488' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{event.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDueDate(event.start_time)}
                          </span>
                          <span>{formatEventTime(event.start_time, event.is_all_day)}</span>
                          {event.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {event.location}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Button asChild className="flex-1">
          <Link href={`/tasks/new?childId=${childId}`}>
            <ListTodo className="w-4 h-4 mr-2" />
            Assign Task
          </Link>
        </Button>
        <Button variant="outline" asChild className="flex-1">
          <Link href={`/calendar/new?childId=${childId}`}>
            <Calendar className="w-4 h-4 mr-2" />
            Add Event
          </Link>
        </Button>
      </div>
    </div>
  )
}
