'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Bell,
  Plus,
  Check,
  X,
  Trash2,
  Repeat,
  Clock,
  Smartphone,
  Mail,
  MessageSquare,
  MoreHorizontal,
  AlarmClockPlus,
  ChevronDown,
  ChevronRight,
  BellRing,
  UserCheck,
} from 'lucide-react'
import { addDays, addMinutes, format, parseISO, set } from 'date-fns'
import { toast } from 'sonner'
import { authFetch, useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { useMyRole } from '@/hooks/use-my-role'
import { useFamilies } from '@/hooks/use-family'
import { AccountStatusBadge } from '@/components/account-status-badge'
import {
  ReminderQuickAdd,
  groupReminders,
  whenText,
  type ReminderGroupKey,
} from '@/components/reminders-extras'

interface Reminder {
  id: string
  title: string
  description?: string
  remind_at: string
  status: string
  is_recurring: boolean
  recurrence_rule: string | null
  sent_at: string | null
  user_id: string
  owner_id?: string
  owner_first_name?: string
  owner_last_name?: string
  owner_name?: string
  child_profile_id?: string | null
  child_name?: string | null
  created_by_id?: string | null
  notify_channels?: NotifyChannel[] | null
  /** A kid's "Ask a parent" reminder: PENDING_APPROVAL until a parent decides. */
  approval_status?: 'PENDING_APPROVAL' | 'APPROVED' | 'DECLINED' | null
}

// Mirrors NotificationChannel in lib/notifications.ts. The API validates and
// stores this per-reminder, and the per-minute delivery cron defaults to
// ['in_app', 'push', 'email'] when a reminder has none.
type NotifyChannel = 'in_app' | 'push' | 'email' | 'sms'

const NOTIFY_CHANNEL_OPTIONS: { value: NotifyChannel; label: string; icon: typeof Bell }[] = [
  { value: 'in_app', label: 'In-app', icon: Bell },
  { value: 'push', label: 'Push', icon: Smartphone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'Text', icon: MessageSquare },
]

// SMS stays opt-in since not everyone has it enabled or a phone number on file.
const DEFAULT_NOTIFY_CHANNELS: NotifyChannel[] = ['in_app', 'push', 'email']

interface FamilyMember {
  id: string
  userId: string | null
  displayName: string
  role?: string
}

const RECURRENCE_OPTIONS = [
  { value: 'NONE', label: "Doesn't repeat" },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
]

type Scope = 'mine' | 'family'
type Chip = 'overdue' | 'today' | 'repeating' | 'sent'

const GROUPS: Array<{ key: ReminderGroupKey; label: string; tone: string }> = [
  { key: 'overdue', label: 'Overdue', tone: 'text-red-600' },
  { key: 'today', label: 'Today', tone: 'text-foreground' },
  { key: 'tomorrow', label: 'Tomorrow', tone: 'text-foreground' },
  { key: 'week', label: 'This week', tone: 'text-muted-foreground' },
  { key: 'later', label: 'Later', tone: 'text-muted-foreground' },
]

// Next.js requires any component that calls useSearchParams() to be wrapped
// in a Suspense boundary, or the page fails to prerender at build time.
export default function RemindersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Spinner className="w-8 h-8 text-primary" />
        </div>
      }
    >
      <RemindersPageContent />
    </Suspense>
  )
}

function RemindersPageContent() {
  const { user } = useAuth()
  const { isSupervisor, isChild } = useMyRole()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  // Set while the dialog is editing an existing reminder rather than
  // creating a new one - same dialog, branches to PATCH instead of POST.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [scopeState, setScope] = useState<Scope | null>(null)
  const [chip, setChip] = useState<Chip | null>(null)
  const [laterOpen, setLaterOpen] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [recurrence, setRecurrence] = useState('NONE')
  const [assigneeId, setAssigneeId] = useState('')
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannel[]>(DEFAULT_NOTIFY_CHANNELS)

  const toggleNotifyChannel = (channel: NotifyChannel) => {
    setNotifyChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    )
  }

  // The family being viewed (switcher choice): the list, new reminders and the
  // people they can be assigned to all come from it.
  const { families, isLoading: familiesLoading } = useFamilies()
  const activeFamily = families[0]
  const activeFamilyId = activeFamily?.id

  const fetchReminders = useCallback(async (silent = false) => {
    if (!activeFamilyId) {
      if (!familiesLoading) setIsLoading(false)
      return
    }
    if (!silent) setIsLoading(true)
    try {
      const res = await authFetch(`/api/reminders?familyId=${encodeURIComponent(activeFamilyId)}`)
      if (res.ok) {
        const data = await res.json()
        setReminders(data.data || [])
      } else {
        toast.error('Could not load reminders')
      }
    } catch (error) {
      console.error('Failed to fetch reminders:', error)
      toast.error('Could not load reminders')
    } finally {
      setIsLoading(false)
    }
  }, [activeFamilyId, familiesLoading])

  useEffect(() => {
    fetchReminders()
  }, [fetchReminders])

  // The Home screen's quick-action row links here with ?new=1 to open
  // straight into the create dialog. Strip the param right after so a later
  // refresh (or the back button) doesn't reopen the dialog unexpectedly.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      const forParam = searchParams.get('for')
      if (forParam) setAssigneeId(forParam)
      setDialogOpen(true)
      router.replace('/dashboard/reminders')
    }
  }, [searchParams, router])

  // The family being viewed (switcher choice). New reminders are created in
  // it and can be assigned to its members (e.g. a spouse or a child). A
  // child with no login is listed too; their reminder is delivered to the
  // parent who creates it.
  useEffect(() => {
    setFamilyMembers(
      (activeFamily?.members || []).map((m) => ({
        id: m.id,
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
      }))
    )
  }, [activeFamily])

  const resetForm = () => {
    setEditingId(null)
    setTitle('')
    setDescription('')
    setRemindAt('')
    setRecurrence('NONE')
    setAssigneeId('')
    setNotifyChannels(DEFAULT_NOTIFY_CHANNELS)
  }

  // Converts a stored UTC ISO timestamp to the local "YYYY-MM-DDTHH:mm" value
  // a <input type="datetime-local"> needs, via the Date's local getters.
  const toDatetimeLocalValue = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const openEditDialog = (reminder: Reminder) => {
    setEditingId(reminder.id)
    setTitle(reminder.title)
    setDescription(reminder.description || '')
    setRemindAt(toDatetimeLocalValue(reminder.remind_at))
    setRecurrence(reminder.is_recurring && reminder.recurrence_rule ? reminder.recurrence_rule : 'NONE')
    setAssigneeId(reminder.user_id !== user?.id ? reminder.user_id : '')
    setNotifyChannels(
      reminder.notify_channels && reminder.notify_channels.length > 0
        ? reminder.notify_channels
        : DEFAULT_NOTIFY_CHANNELS
    )
    setDialogOpen(true)
  }

  const upsert = (row: Reminder) =>
    setReminders((prev) => {
      const old = prev.find((r) => r.id === row.id)
      // PATCH returns the bare row without the joined owner/child names
      const merged = { ...(old || {}), ...row } as Reminder
      return [...prev.filter((r) => r.id !== row.id), merged].sort((a, b) =>
        a.remind_at.localeCompare(b.remind_at)
      )
    })

  // askParent: a child's "Ask a parent" (the reminder waits for approval).
  const handleSave = async (askParent = false) => {
    if (!title.trim() || !remindAt) return
    setIsSaving(true)
    try {
      const res = await authFetch(editingId ? `/api/reminders/${editingId}` : '/api/reminders', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          remindAt: new Date(remindAt).toISOString(),
          isRecurring: recurrence !== 'NONE',
          // Explicit null (not undefined) so editing a recurring reminder
          // back to "Doesn't repeat" actually clears recurrence_rule.
          recurrenceRule: recurrence !== 'NONE' ? recurrence : null,
          forMemberId: !editingId ? assigneeId || undefined : undefined,
          // New reminders belong to the family being viewed, not the account's owned family.
          familyId: !editingId ? activeFamily?.id : undefined,
          notifyChannels,
          askParent: !editingId && askParent ? true : undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (editingId) upsert(data.data)
        else {
          // A newly created row may belong to someone else - reload so the
          // joined owner name comes back with it.
          await fetchReminders(true)
        }
        toast.success(editingId ? 'Reminder updated' : askParent ? 'Sent to a parent to approve' : 'Reminder created')
        resetForm()
        setDialogOpen(false)
      } else {
        const j = await res.json().catch(() => null)
        toast.error(j?.error || 'Could not save reminder')
      }
    } catch (error) {
      console.error(editingId ? 'Failed to update reminder:' : 'Failed to create reminder:', error)
      toast.error('Could not save reminder')
    } finally {
      setIsSaving(false)
    }
  }

  // A parent answers a kid's "Ask a parent" reminder.
  const decide = async (id: string, action: 'approve' | 'decline') => {
    setProcessingId(id)
    try {
      const res = await authFetch(`/api/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) { toast.error(j?.error || 'Something went wrong - try again'); return }
      if (action === 'approve') upsert(j.data)
      else setReminders((prev) => prev.filter((r) => r.id !== id))
      toast.success(action === 'approve' ? 'Reminder approved' : 'Reminder declined')
    } catch {
      toast.error('Something went wrong - try again')
    } finally {
      setProcessingId(null)
    }
  }

  const patchStatus = async (id: string, action: 'complete' | 'dismiss', okMsg: string) => {
    setProcessingId(id)
    try {
      const res = await authFetch(`/api/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        setReminders((prev) => prev.filter((r) => r.id !== id))
        toast.success(okMsg)
      } else {
        toast.error('Something went wrong - try again')
      }
    } catch (error) {
      console.error(`Failed to ${action} reminder:`, error)
      toast.error('Something went wrong - try again')
    } finally {
      setProcessingId(null)
    }
  }

  // Snooze = move the time forward. The PATCH route clears sent_at whenever
  // remindAt changes, so the delivery cron will consider it due again.
  const handleSnooze = async (r: Reminder, to: Date, label: string) => {
    setProcessingId(r.id)
    try {
      const res = await authFetch(`/api/reminders/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindAt: to.toISOString() }),
      })
      if (res.ok) {
        const data = await res.json()
        upsert(data.data)
        toast.success(`Snoozed until ${label}`)
      } else {
        toast.error('Could not snooze')
      }
    } catch {
      toast.error('Could not snooze')
    } finally {
      setProcessingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this reminder permanently?')) return
    setProcessingId(id)
    try {
      const res = await authFetch(`/api/reminders/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setReminders((prev) => prev.filter((r) => r.id !== id))
        toast.success('Reminder deleted')
      } else {
        toast.error('Could not delete reminder')
      }
    } catch (error) {
      console.error('Failed to delete reminder:', error)
      toast.error('Could not delete reminder')
    } finally {
      setProcessingId(null)
    }
  }

  // A reminder set for a child who has no login is owned by the parent (so
  // user_id is the parent's) but carries the child's name - that one is "for
  // others". A child who does have a login owns their own reminders, and
  // those carry their own profile name too, so for a child viewer it's mine.
  const viewerIsChild = familyMembers.find((m) => m.userId === user?.id)?.role === 'CHILD'
  const isMine = useCallback(
    (r: Reminder) =>
      r.user_id === user?.id &&
      (!r.child_name || viewerIsChild || (!!r.created_by_id && r.created_by_id !== user?.id)),
    [user?.id, viewerIsChild]
  )
  const mineCount = reminders.filter(isMine).length
  const familyCount = reminders.length - mineCount

  // Default to "mine", unless that's empty and the user set some up for others
  const scope: Scope = scopeState ?? (mineCount === 0 && familyCount > 0 ? 'family' : 'mine')

  const scoped = useMemo(
    () => reminders.filter((r) => (scope === 'mine' ? isMine(r) : !isMine(r))),
    [reminders, scope, isMine]
  )

  const nowMs = Date.now()
  const counts = {
    overdue: scoped.filter((r) => parseISO(r.remind_at).getTime() < nowMs).length,
    today: scoped.filter((r) => {
      const d = parseISO(r.remind_at)
      return d.getTime() >= nowMs && d.toDateString() === new Date().toDateString()
    }).length,
    repeating: scoped.filter((r) => r.is_recurring).length,
    sent: scoped.filter((r) => !!r.sent_at).length,
  }

  const visible = scoped.filter((r) => {
    if (!chip) return true
    if (chip === 'overdue') return parseISO(r.remind_at).getTime() < nowMs
    if (chip === 'today') {
      const d = parseISO(r.remind_at)
      return d.getTime() >= nowMs && d.toDateString() === new Date().toDateString()
    }
    if (chip === 'repeating') return r.is_recurring
    return !!r.sent_at
  })
  const groups = groupReminders(visible)

  const next = scoped.find((r) => parseISO(r.remind_at).getTime() >= nowMs)

  const ownerName = (r: Reminder) =>
    isMine(r)
      ? ''
      : r.child_name ||
        (r.user_id !== user?.id ? r.owner_name || '' : '')

  const snoozeOptions = (): Array<{ label: string; to: Date }> => {
    const now = new Date()
    const tomorrow9 = set(addDays(now, 1), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 })
    return [
      { label: '10 minutes', to: addMinutes(now, 10) },
      { label: '1 hour', to: addMinutes(now, 60) },
      { label: 'Tomorrow 9:00 AM', to: tomorrow9 },
    ]
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    )
  }

  const chipDefs: Array<{ key: Chip; label: string; dot: string; n: number }> = [
    { key: 'overdue', label: 'Overdue', dot: 'bg-red-500', n: counts.overdue },
    { key: 'today', label: 'Today', dot: 'bg-blue-500', n: counts.today },
    { key: 'repeating', label: 'Repeating', dot: 'bg-violet-500', n: counts.repeating },
    { key: 'sent', label: 'Notified', dot: 'bg-amber-500', n: counts.sent },
  ]

  const nothing = visible.length === 0

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Reminders</h1>
          <p className="truncate text-sm text-muted-foreground">
            {next ? (
              <>
                Next: <span className="font-medium text-foreground">{next.title}</span> · {whenText(next.remind_at)}
              </>
            ) : (
              "Quick nudges that aren't tied to a task or event"
            )}
          </p>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="shrink-0 gap-1.5">
              <Plus className="w-4 h-4" />
              New
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit reminder' : 'New reminder'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="reminder-title">Title</Label>
                <Input
                  id="reminder-title"
                  placeholder="Take medication"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reminder-description">Notes (optional)</Label>
                <Textarea
                  id="reminder-description"
                  placeholder="Any extra details"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reminder-time">Remind me at</Label>
                <Input
                  id="reminder-time"
                  type="datetime-local"
                  value={remindAt}
                  onChange={(e) => setRemindAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reminder-recurrence">Repeat</Label>
                <Select value={recurrence} onValueChange={setRecurrence}>
                  <SelectTrigger id="reminder-recurrence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Notify me via</Label>
                <div className="flex flex-wrap gap-1.5">
                  {NOTIFY_CHANNEL_OPTIONS.map(({ value, label, icon: Icon }) => {
                    const selected = notifyChannels.includes(value)
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleNotifyChannel(value)}
                        aria-pressed={selected}
                        className={cn(
                          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    )
                  })}
                </div>
                {notifyChannels.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Pick at least one way to hear about this, or it won&apos;t notify you at all.
                  </p>
                )}
              </div>
              {!editingId && familyMembers.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor="reminder-assignee">Assign to</Label>
                  <Select value={assigneeId || 'me'} onValueChange={(v) => setAssigneeId(v === 'me' ? '' : v)}>
                    <SelectTrigger id="reminder-assignee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="me">Myself</SelectItem>
                      {familyMembers
                        // Only parents/guardians may set reminders for children (server rule).
                        .filter((m) => m.userId !== user?.id && (isSupervisor || m.role !== 'CHILD'))
                        .map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-2">
                              {m.displayName}
                              {isSupervisor && m.role === 'CHILD' && <AccountStatusBadge hasAccount={!!m.userId} />}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {/* A child with no login can't get the reminder; the API sends it to you, labeled with their name. */}
                  {(() => {
                    const target = familyMembers.find((m) => m.id === assigneeId)
                    return target && target.role === 'CHILD' && !target.userId ? (
                      <p className="text-xs text-muted-foreground">
                        {target.displayName} has no login, so this reminder will come to you.
                      </p>
                    ) : null
                  })()}
                </div>
              )}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              {/* Kids create freely; "Ask a parent" sends it for approval first. */}
              {isChild && !editingId && (
                <Button
                  variant="outline"
                  onClick={() => handleSave(true)}
                  disabled={!title.trim() || !remindAt || notifyChannels.length === 0 || isSaving}
                  className="w-full"
                >
                  <UserCheck className="mr-2 h-4 w-4" />
                  Ask a parent
                </Button>
              )}
              <Button
                onClick={() => handleSave()}
                disabled={!title.trim() || !remindAt || notifyChannels.length === 0 || isSaving}
                className="w-full"
              >
                {isSaving ? <Spinner className="w-4 h-4" /> : editingId ? 'Save changes' : 'Create reminder'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <ReminderQuickAdd members={familyMembers} familyId={activeFamily?.id} onCreated={() => fetchReminders(true)} />

      {/* Who */}
      {familyCount > 0 && (
        <div className="inline-flex rounded-lg bg-muted p-1">
          {(
            [
              { key: 'mine', label: 'Mine', n: mineCount },
              { key: 'family', label: 'For others', n: familyCount },
            ] as Array<{ key: Scope; label: string; n: number }>
          ).map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => {
                setScope(d.key)
                setChip(null)
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                scope === d.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {d.label}
              <span className="ml-1.5 text-xs text-muted-foreground">{d.n}</span>
            </button>
          ))}
        </div>
      )}

      {/* Status chips */}
      {scoped.length > 0 && (
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
      )}

      {/* List */}
      {nothing ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              {chip
                ? 'Nothing matches that filter'
                : scope === 'family'
                  ? "You haven't set any reminders for others"
                  : 'No reminders yet - type one above to get started'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const items = groups[g.key]
            if (items.length === 0) return null
            const collapsible = g.key === 'later'
            const open = !collapsible || laterOpen || !!chip
            return (
              <section key={g.key}>
                <button
                  type="button"
                  disabled={!collapsible}
                  onClick={() => collapsible && setLaterOpen((v) => !v)}
                  className={cn(
                    'mb-2 flex items-center gap-1 text-sm font-semibold',
                    g.tone,
                    collapsible && 'hover:text-foreground'
                  )}
                >
                  {collapsible && (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                  {g.label}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{items.length}</span>
                </button>
                {open && (
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                    {items.map((reminder) => {
                      const overdue = g.key === 'overdue'
                      const activeChannels =
                        reminder.notify_channels && reminder.notify_channels.length > 0
                          ? reminder.notify_channels
                          : DEFAULT_NOTIFY_CHANNELS
                      const who = ownerName(reminder)
                      const busy = processingId === reminder.id
                      return (
                        <div
                          key={reminder.id}
                          className={cn(
                            'flex min-w-0 items-start gap-3 rounded-lg border bg-card p-3',
                            overdue ? 'border-red-200' : 'border-border'
                          )}
                        >
                          <button
                            onClick={() => patchStatus(reminder.id, 'complete', 'Marked done')}
                            disabled={busy}
                            aria-label="Mark done"
                            className="group mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 transition-colors hover:border-primary hover:bg-primary/10"
                          >
                            {busy ? (
                              <Spinner className="h-3 w-3" />
                            ) : (
                              <Check className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => openEditDialog(reminder)}
                              className="block w-full truncate text-left font-medium hover:underline"
                            >
                              {reminder.title}
                            </button>
                            {reminder.description && (
                              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                                {reminder.description}
                              </p>
                            )}
                            {reminder.approval_status === 'PENDING_APPROVAL' && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
                                  Waiting for a parent
                                </span>
                                {isSupervisor && (
                                  <>
                                    <Button size="sm" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => decide(reminder.id, 'approve')}>
                                      <Check className="mr-1 h-3.5 w-3.5" />
                                      Approve
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => decide(reminder.id, 'decline')}>
                                      Decline
                                    </Button>
                                  </>
                                )}
                              </div>
                            )}
                            <div
                              className={cn(
                                'mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs',
                                overdue ? 'text-red-600' : 'text-muted-foreground'
                              )}
                            >
                              <span className="inline-flex items-center gap-1" title={format(parseISO(reminder.remind_at), 'PPpp')}>
                                <Clock className="h-3 w-3" />
                                {whenText(reminder.remind_at)}
                              </span>
                              {reminder.is_recurring && (
                                <span className="inline-flex items-center gap-1">
                                  <Repeat className="h-3 w-3" />
                                  {reminder.recurrence_rule?.toLowerCase()}
                                </span>
                              )}
                              {who && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground">
                                  {who}
                                </span>
                              )}
                              {reminder.sent_at && (
                                <span className="inline-flex items-center gap-1 text-amber-600" title="A notification was already sent">
                                  <BellRing className="h-3 w-3" />
                                  Notified
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1">
                                {NOTIFY_CHANNEL_OPTIONS.filter((opt) => activeChannels.includes(opt.value)).map(
                                  ({ value, label, icon: Icon }) => (
                                    <Icon key={value} className="h-3 w-3" aria-label={label} />
                                  )
                                )}
                              </span>
                            </div>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                disabled={busy}
                                aria-label="More actions"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {snoozeOptions().map((o) => (
                                <DropdownMenuItem key={o.label} onClick={() => handleSnooze(reminder, o.to, o.label)}>
                                  <AlarmClockPlus className="mr-2 h-4 w-4" />
                                  Snooze {o.label}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => patchStatus(reminder.id, 'dismiss', 'Dismissed')}>
                                <X className="mr-2 h-4 w-4" />
                                Dismiss
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDelete(reminder.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
