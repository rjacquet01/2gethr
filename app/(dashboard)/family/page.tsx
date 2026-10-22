'use client'

import { InviteCodesCard, JoinRequestsCard } from '@/components/invite-codes'
import { useState } from 'react'
import { useFamilies, useFamily } from '@/hooks/use-family'
import { useMyRole } from '@/hooks/use-my-role'
import { useSubscription } from '@/hooks/use-subscription'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import useSWR, { mutate as globalMutate } from 'swr'
import { authFetch, useAuth } from '@/hooks/use-auth'
import { 
  Users, 
  UserPlus, 
  Copy, 
  Check, 
  Crown,
  Shield,
  Baby,
  Settings,
  MapPin,
  Mail,
  MessageSquare,
  Share2,
  ListTodo,
  Calendar,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
  UserMinus,
  LogOut,
  Bell,
  UserCheck,
  UserRound
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { MemberAvatar, AppearanceButton } from '@/components/member-avatar'
import { AccountStatusBadge } from '@/components/account-status-badge'
import { FamilyNameButton } from '@/components/family-name-button'
import { JoinFamilyButton } from '@/components/join-family-dialog'
import { StartOwnFamilyButton, useCanStartOwnFamily } from '@/components/start-own-family'
import { BirthdateInput, ChildAccountDialog, ChildConsentBox, ChildConsentDialog, RoleChoiceCard, Turns18Chip, type AgeAwareChild } from '@/components/child-age'

export default function FamilyPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  const { user } = useAuth()
  const { family, generateInviteCode, addChild, removeMember, isLoading: familyLoading, mutate: mutateFamily } = useFamily(primaryFamily?.id || null)
  // The member cards come from member-activities: refresh them after changes
  // to who is in the family (they stayed stale until a reload).
  const refreshActivities = () => {
    if (primaryFamily?.id) globalMutate(`/api/families/${primaryFamily.id}/member-activities`)
  }
  const { access } = useSubscription(primaryFamily?.id || null)
  const viewerRole = (primaryFamily as unknown as { currentUserRole?: string; userRole?: string } | undefined)
  // Parents/guardians only (ADULT members are peers, not supervisors).
  const viewerIsAdult = ['PARENT', 'GUARDIAN'].includes(viewerRole?.currentUserRole || viewerRole?.userRole || '')
  const { isGuest } = useMyRole()
  const canStartOwn = useCanStartOwnFamily()
  // Role choices at 18 and child account invites are parent/owner actions.
  const viewerIsParent = (viewerRole?.currentUserRole || viewerRole?.userRole) === 'PARENT' || (!!family && !!user && family.ownerId === user.id)
  const [childBirthdate, setChildBirthdate] = useState('')
  const [accountChild, setAccountChild] = useState<AgeAwareChild | null>(null)
  const [consentChild, setConsentChild] = useState<{ memberId: string; name: string } | null>(null)
  
  const [copiedCode, setCopiedCode] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAddingChild, setIsAddingChild] = useState(false)
  const [addChildOpen, setAddChildOpen] = useState(false)
  // The parent's consent for this child (starts unchecked; required by the server).
  const [childConsent, setChildConsent] = useState(false)
  const [childName, setChildName] = useState('')
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [addMode, setAddMode] = useState<'select' | 'create'>('select')
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set())
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const [memberToRemove, setMemberToRemove] = useState<{ id: string; name: string; isSelf: boolean; isChild?: boolean } | null>(null)
  const [isRemovingMember, setIsRemovingMember] = useState(false)

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return
    setIsRemovingMember(true)
    const result = await removeMember(memberToRemove.id)
    setIsRemovingMember(false)
    if (result.success) {
      refreshActivities()
      if (memberToRemove.isSelf) {
        toast.success('You have left the family')
        // Our membership is gone - refresh the family list so we fall back to another family.
        globalMutate('/api/families')
      } else {
        toast.success(`${memberToRemove.name} was removed. A new invite code was generated.`)
      }
      setMemberToRemove(null)
    } else {
      toast.error(result.error || 'Failed to remove member')
    }
  }

  const toggleMemberExpanded = (memberId: string) => {
    setExpandedMembers(prev => {
      const next = new Set(prev)
      if (next.has(memberId)) {
        next.delete(memberId)
      } else {
        next.add(memberId)
      }
      return next
    })
  }

  // Fetch unassigned members (users who joined but don't have child profile)
  const fetcher = async (url: string) => {
    const res = await authFetch(url)
    if (!res.ok) throw new Error('Failed to fetch')
    const data = await res.json()
    return data.data
  }

  interface UnassignedMember {
    memberId: string
    userId: string
    currentRole: string
    displayName: string
    email: string
    avatarUrl?: string
  }

  const { data: unassignedMembers = [], mutate: mutateUnassigned } = useSWR<UnassignedMember[]>(
    primaryFamily?.id ? `/api/families/${primaryFamily.id}/unassigned-members` : null,
    fetcher
  )

  interface MemberActivity {
    memberId: string
    userId: string | null
    displayName: string
    avatarUrl: string | null
    color?: string | null
    emoji?: string | null
    role: string
    hasAccount?: boolean
    childProfileId: string | null
    tasks: Array<{
      id: string
      title: string
      status: string
      priority: string
      due_date: string | null
      due_time: string | null
      category: string | null
    }>
    events: Array<{
      id: string
      title: string
      start_time: string
      end_time: string
      is_all_day: boolean
      location: string | null
      color: string | null
    }>
    taskCount: number
    eventCount: number
    reminders?: Array<{
      id: string
      title: string
      remind_at: string
    }>
    reminderCount?: number
  }

  // Guests don't get the per-member activity overview (the server refuses it).
  const { data: memberActivities = [], isLoading: activitiesLoading, mutate: mutateActivities } = useSWR<MemberActivity[]>(
    primaryFamily?.id && !isGuest ? `/api/families/${primaryFamily.id}/member-activities` : null,
    fetcher
  )

  const getInviteMessage = () => {
    const code = family?.inviteCode
    const familyName = family?.name || 'our family'
    const link = typeof window !== 'undefined' ? `${window.location.origin}/onboarding?code=${code}` : ''
    return `Join ${familyName} on Togethr! Tap this link to join: ${link}\n\nOr open the app and enter invite code: ${code}`
  }

  const handleShareEmail = () => {
    const subject = encodeURIComponent(`Join ${family?.name || 'our family'} on Togethr`)
    const body = encodeURIComponent(getInviteMessage())
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
  }

  const handleShareSMS = () => {
    const message = encodeURIComponent(getInviteMessage())
    // Use sms: protocol - works on mobile devices
    window.open(`sms:?body=${message}`, '_blank')
  }

  const handleShareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${family?.name || 'our family'} on Togethr`,
          text: getInviteMessage(),
        })
      } catch (err) {
        // User cancelled or share failed - ignore
        if ((err as Error).name !== 'AbortError') {
          toast.error('Failed to share')
        }
      }
    } else {
      // Fallback to copy
      handleCopyCode()
    }
  }

  const handleGenerateInviteCode = async () => {
    setIsGenerating(true)
    const result = await generateInviteCode()
    if (result.success) {
      toast.success('Invite code generated!')
    } else {
      toast.error(result.error || 'Failed to generate code')
    }
    setIsGenerating(false)
  }

  const handleCopyCode = () => {
    if (family?.inviteCode) {
      navigator.clipboard.writeText(family.inviteCode)
      setCopiedCode(true)
      toast.success('Code copied to clipboard')
      setTimeout(() => setCopiedCode(false), 2000)
    }
  }

  const handleAddChild = async () => {
    // If selecting from existing members
    if (addMode === 'select' && selectedMemberId) {
      const selectedMember = unassignedMembers.find(m => m.memberId === selectedMemberId)
      if (!selectedMember) {
        toast.error('Please select a family member')
        return
      }
      
      setIsAddingChild(true)
      const result = await addChild({
        displayName: childName.trim() || selectedMember.displayName,
        existingMemberId: selectedMemberId,
        consent: childConsent,
        ...(childBirthdate ? { dateOfBirth: childBirthdate } : {}),
      })

      if (result.success) {
        toast.success('Member assigned as child successfully!')
        setChildName('')
        setChildBirthdate('')
        setSelectedMemberId('')
        setAddChildOpen(false)
        setChildConsent(false)
        mutateUnassigned()
        refreshActivities()
      } else {
        toast.error(result.error || 'Failed to assign member')
      }
      
      setIsAddingChild(false)
      return
    }
    
    // Creating new child profile
    if (!childName.trim()) {
      toast.error('Please enter a name')
      return
    }
    
    setIsAddingChild(true)
    const result = await addChild({ displayName: childName, consent: childConsent, ...(childBirthdate ? { dateOfBirth: childBirthdate } : {}) })

    if (result.success) {
      toast.success('Child added successfully!')
      refreshActivities()
      setChildName('')
      setChildBirthdate('')
      setAddChildOpen(false)
      setChildConsent(false)
    } else {
      toast.error(result.error || 'Failed to add child')
    }
    
    setIsAddingChild(false)
  }

  // Parent/Guardian/Adult/Guest get a role badge; kids are not labeled
  const roleLabel = (role: string) =>
    role === 'PARENT' ? 'Parent'
      : role === 'GUARDIAN' ? 'Guardian'
      : role === 'ADULT' ? 'Adult'
      : role === 'GUEST' ? 'Guest'
      : 'Member'

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'PARENT': return Crown
      case 'GUARDIAN': return Shield
      case 'ADULT': return UserCheck
      case 'GUEST': return UserRound
      case 'CHILD': return Baby
      default: return Users
    }
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'PARENT': return 'default'
      case 'GUARDIAN': return 'secondary'
      case 'ADULT': return 'secondary'
      case 'GUEST': return 'outline'
      case 'CHILD': return 'outline'
      default: return 'outline'
    }
  }

  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return 'No due date'
    const date = new Date(dateStr)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const formatEventTime = (dateStr: string, isAllDay: boolean) => {
    if (isAllDay) return 'All day'
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const getPriorityColor = (priority: string) => {
    switch (priority?.toUpperCase()) {
      case 'HIGH': return 'text-red-500'
      case 'MEDIUM': return 'text-yellow-500'
      case 'LOW': return 'text-green-500'
      default: return 'text-muted-foreground'
    }
  }

  // Leave / remove confirmation (used by the full page and the guest card).
  const leaveDialog = (
    <AlertDialog open={!!memberToRemove} onOpenChange={(open) => { if (!open && !isRemovingMember) setMemberToRemove(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {memberToRemove?.isSelf ? 'Leave this family?' : `Remove ${memberToRemove?.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {memberToRemove?.isSelf
              ? 'You will lose access to this family\'s calendar, tasks and locations. You can rejoin later with a new invite code.'
              : memberToRemove?.isChild
                ? `${memberToRemove.name}'s child profile (name, birthdate, school and notes), location settings and, if this is their only family, their login will be permanently deleted. This can't be undone.`
                : 'They will immediately lose access to this family\'s calendar, tasks and locations. A new invite code will be generated so they can\'t rejoin with the old one.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemovingMember}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isRemovingMember}
            onClick={(e) => { e.preventDefault(); handleConfirmRemove() }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isRemovingMember ? <Spinner className="w-4 h-4 mr-2" /> : null}
            {memberToRemove?.isSelf ? 'Leave Family' : 'Remove Member'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (familiesLoading || familyLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!family) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Empty
          title="No family yet"
          description="Create or join a family to get started"
        />
        <Button asChild className="mt-6">
          <Link href="/onboarding">Get Started</Link>
        </Button>
      </div>
    )
  }

  // A guest doesn't see the family's structure: no members, children, invite
  // codes, settings, join requests or activity (the server sends none of it
  // either). Just the family name, their own membership and a way out.
  if (isGuest) {
    const me = family.members?.find((m) => m.userId === user?.id)
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-20 lg:pb-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{family.name}</CardTitle>
            <CardDescription>You&apos;re a guest in this family</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <MemberAvatar
                name={me?.displayName || user?.firstName || 'You'}
                avatarUrl={me?.avatarUrl}
                color={me?.color}
                emoji={me?.emoji}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{me?.displayName || 'You'}</p>
                <Badge variant="outline" className="mt-1">
                  <UserRound className="mr-1 h-3 w-3" />
                  Guest
                </Badge>
              </div>
              {me && (
                <FamilyNameButton
                  familyId={family.id}
                  familyName={family.name}
                  nickname={me.nickname ?? ''}
                  accountFirstName={user?.firstName || ''}
                  onSaved={() => mutateFamily()}
                />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              You can see the calendar events and tasks you&apos;re part of, plus your own archive.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/calendar">Calendar</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/tasks">Tasks</Link>
              </Button>
              {me && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setMemberToRemove({ id: me.id, name: me.displayName, isSelf: true })}
                >
                  <LogOut className="mr-1 h-4 w-4" />
                  Leave this family
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        {canStartOwn && (
          <Card>
            <CardContent className="flex flex-col items-start gap-2 py-4">
              <p className="text-sm text-muted-foreground">
                Want your own family? Start one without a new account. You&apos;ll stay in this one too.
              </p>
              <StartOwnFamilyButton />
            </CardContent>
          </Card>
        )}
        {leaveDialog}
      </div>
    )
  }

  const totals = memberActivities.reduce(
    (a, m) => ({
      tasks: a.tasks + (m.taskCount || 0),
      events: a.events + (m.eventCount || 0),
      reminders: a.reminders + (m.reminderCount || 0),
    }),
    { tasks: 0, events: 0, reminders: 0 }
  )
  const memberCount = family.members?.length || 0
  const childCount = family.children?.length || 0

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-foreground sm:text-2xl">{family.name}</h1>
          <p className="text-sm text-muted-foreground">
            {memberCount} member{memberCount === 1 ? '' : 's'}
            {childCount > 0 && ` · ${childCount} child${childCount === 1 ? '' : 'ren'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewerIsAdult && (
            <Button size="sm" onClick={() => setInviteOpen((v) => !v)}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              Invite
            </Button>
          )}
          {viewerIsAdult && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setManageOpen(true)
                setAddChildOpen(true)
              }}
            >
              <Baby className="mr-1.5 h-4 w-4" />
              Add child
            </Button>
          )}
          <JoinFamilyButton />
          <StartOwnFamilyButton />
          <Button variant="outline" size="sm" asChild>
            <Link href="/family/settings">
              <Settings className="mr-1.5 h-4 w-4" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* 18th birthdays: a parent chooses Guardian, Adult or keep as child */}
      {viewerIsParent &&
        (family.children || [])
          .filter((c) => c.needsRoleChoice)
          .map((c) => (
            <RoleChoiceCard
              key={c.id}
              familyId={family.id}
              child={c}
              onChanged={() => {
                mutateFamily()
                globalMutate('/api/families')
              }}
              onCreateAccount={setAccountChild}
            />
          ))}

      {/* Join requests wait for a decision, so they are always visible */}
      <JoinRequestsCard familyId={family.id} onAnswered={() => { mutateFamily(); mutateActivities() }} />
      {inviteOpen && (
        <InviteCodesCard
          familyId={family.id}
          familyName={family.name || 'our family'}
          canInviteChild={viewerIsParent}
          onChildAdded={() => { mutateFamily(); mutateActivities() }}
        />
      )}

      {/* Family at a glance */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
          <ListTodo className="h-3.5 w-3.5 text-blue-500" />
          {totals.tasks} open task{totals.tasks === 1 ? '' : 's'}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
          <Calendar className="h-3.5 w-3.5 text-emerald-500" />
          {totals.events} upcoming event{totals.events === 1 ? '' : 's'}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
          <Bell className="h-3.5 w-3.5 text-amber-500" />
          {totals.reminders} reminder{totals.reminders === 1 ? '' : 's'}
        </span>
      </div>

      {/* Who is doing what - tap a person to see the details */}
      {activitiesLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : memberActivities.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <Empty
              title={isGuest ? 'You are a guest in this family' : 'No activities yet'}
              description={
                isGuest
                  ? 'Guests can use the family calendar and tasks.'
                  : 'Tasks and events will appear here when assigned to family members'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {memberActivities.map((member) => {
            const RoleIcon = getRoleIcon(member.role)
            const memberChild = member.childProfileId ? family.children?.find((c) => c.id === member.childProfileId) : undefined
            const expanded = expandedMembers.has(member.memberId)
            const firstTab = member.tasks.length > 0 ? 'tasks' : member.events.length > 0 ? 'events' : 'reminders'
            const nextEvent = member.events[0]
            const empty = member.tasks.length === 0 && member.events.length === 0 && (member.reminders?.length ?? 0) === 0

            return (
              <div
                key={member.memberId}
                className={cn(
                  'overflow-hidden rounded-xl border bg-card',
                  expanded && 'sm:col-span-2 xl:col-span-3'
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleMemberExpanded(member.memberId)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/40"
                >
                  <MemberAvatar name={member.displayName} avatarUrl={member.avatarUrl} color={member.color} emoji={member.emoji} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-medium text-foreground">
                        {member.displayName}
                        {member.userId && member.userId === user?.id && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                      </p>
                      {member.role !== 'CHILD' && (
                        <Badge variant={getRoleBadgeVariant(member.role) as 'default' | 'secondary' | 'outline'} className="shrink-0 px-1.5 py-0 text-[10px]">
                          <RoleIcon className="mr-1 h-3 w-3" />
                          {roleLabel(member.role)}
                        </Badge>
                      )}
                      {viewerIsAdult && member.role === 'CHILD' && (
                        <AccountStatusBadge hasAccount={member.hasAccount ?? !!member.userId} />
                      )}
                      {memberChild?.age != null && (
                        <span className="shrink-0 text-xs text-muted-foreground">Age {memberChild.age}</span>
                      )}
                    </div>
                    {memberChild && <div className="mt-1 empty:hidden"><Turns18Chip child={memberChild} /></div>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <ListTodo className="h-3 w-3" />
                        {member.taskCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {member.eventCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Bell className="h-3 w-3" />
                        {member.reminderCount || 0}
                      </span>
                    </div>
                    {nextEvent && !expanded && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Next: <span className="text-foreground">{nextEvent.title}</span> · {formatDueDate(nextEvent.start_time)}{' '}
                        {formatEventTime(nextEvent.start_time, nextEvent.is_all_day)}
                      </p>
                    )}
                  </div>
                  {expanded ? (
                    <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </button>

                {expanded && (
                  <div className="border-t">
                    <div className="flex flex-wrap gap-2 p-3 pb-0">
                      {viewerIsAdult && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/dashboard/reminders?new=1${member.userId === user?.id ? '' : `&for=${member.memberId}`}`}>
                            <Bell className="mr-1.5 h-4 w-4" />
                            Add reminder
                          </Link>
                        </Button>
                      )}
                      {member.childProfileId && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/family/child/${member.childProfileId}`}>
                            <Settings className="mr-1.5 h-4 w-4" />
                            Profile & settings
                          </Link>
                        </Button>
                      )}
                    </div>
                    {empty ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <AlertCircle className="mx-auto mb-2 h-5 w-5 opacity-50" />
                        Nothing assigned yet
                      </div>
                    ) : (
                            <Tabs defaultValue={firstTab} className="w-full">
                              <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0">
                                <TabsTrigger 
                                  value="tasks" 
                                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                                >
                                  Tasks ({member.tasks.length})
                                </TabsTrigger>
                                <TabsTrigger 
                                  value="events"
                                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                                >
                                  Events ({member.events.length})
                                </TabsTrigger>
                                <TabsTrigger 
                                  value="reminders"
                                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                                >
                                  Reminders ({member.reminderCount || 0})
                                </TabsTrigger>
                              </TabsList>
                              <TabsContent value="tasks" className="mt-0 p-3">
                                {member.tasks.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">No pending tasks</p>
                                ) : (
                                  <div className="space-y-2">
                                    {member.tasks.map((task) => (
                                      <Link
                                        key={task.id}
                                        href={`/tasks/${task.id}`}
                                        className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                                      >
                                        <div className={`w-2 h-2 rounded-full ${getPriorityColor(task.priority)} bg-current`} />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium truncate">{task.title}</p>
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Clock className="w-3 h-3" />
                                            {formatDueDate(task.due_date)}
                                            {task.category && (
                                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                                {task.category}
                                              </Badge>
                                            )}
                                          </div>
                                        </div>
                                        <Badge 
                                          variant={task.status === 'IN_PROGRESS' ? 'default' : 'secondary'}
                                          className="text-[10px]"
                                        >
                                          {task.status.replace('_', ' ')}
                                        </Badge>
                                      </Link>
                                    ))}
                                    {member.taskCount > 5 && (
                                      <Button variant="ghost" size="sm" className="w-full text-xs" asChild>
                                        <Link href={`/tasks?assignedTo=${member.userId || member.childProfileId}`}>
                                          View all {member.taskCount} tasks
                                        </Link>
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </TabsContent>
                              <TabsContent value="events" className="mt-0 p-3">
                                {member.events.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">No upcoming events</p>
                                ) : (
                                  <div className="space-y-2">
                                    {member.events.map((event) => (
                                      <Link
                                        key={event.id}
                                        href={`/calendar?event=${event.id}`}
                                        className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                                      >
                                        <div 
                                          className="w-2 h-full min-h-[2rem] rounded-full"
                                          style={{ backgroundColor: event.color || '#0d9488' }}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium truncate">{event.title}</p>
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Calendar className="w-3 h-3" />
                                            {formatDueDate(event.start_time)} at {formatEventTime(event.start_time, event.is_all_day)}
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
                                    {member.eventCount > 5 && (
                                      <Button variant="ghost" size="sm" className="w-full text-xs" asChild>
                                        <Link href="/calendar">
                                          View all events
                                        </Link>
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </TabsContent>
                              <TabsContent value="reminders" className="mt-0 p-3">
                                {(member.reminders?.length ?? 0) === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">No pending reminders</p>
                                ) : (
                                  <div className="space-y-2">
                                    {member.reminders?.map((reminder) => (
                                      <Link
                                        key={reminder.id}
                                        href="/dashboard/reminders"
                                        className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                                      >
                                        <Bell className="w-4 h-4 text-primary shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium truncate">{reminder.title}</p>
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Clock className="w-3 h-3" />
                                            {formatDueDate(reminder.remind_at)} at {formatEventTime(reminder.remind_at, false)}
                                          </div>
                                        </div>
                                      </Link>
                                    ))}
                                    {(member.reminderCount ?? 0) > 5 && (
                                      <Button variant="ghost" size="sm" className="w-full text-xs" asChild>
                                        <Link href="/dashboard/reminders">
                                          View all {member.reminderCount} reminders
                                        </Link>
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </TabsContent>
                            </Tabs>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}


      {leaveDialog}

      {/* Members, children and their settings */}
      <button
        type="button"
        onClick={() => setManageOpen((v) => !v)}
        aria-expanded={manageOpen}
        className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 font-medium">
          <Users className="h-4 w-4 text-muted-foreground" />
          Manage members &amp; children
          <span className="text-xs font-normal text-muted-foreground">
            {memberCount} · {childCount}
          </span>
        </span>
        {manageOpen ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
      </button>


      <div className={cn(!manageOpen && "hidden")}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {/* Family Members */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Members</CardTitle>
              <CardDescription>{family.members?.length || 0} members</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {family.members?.map((member) => {
                const RoleIcon = getRoleIcon(member.role)
                const initials = member.displayName
                  ?.split(' ')
                  .map(n => n[0])
                  .join('')
                  .toUpperCase() || '?'
                  
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border"
                  >
                    <MemberAvatar name={member.displayName} avatarUrl={member.avatarUrl} color={member.color} emoji={member.emoji} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {member.displayName}
                        {member.userId === user?.id && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                      </p>
                      {member.role !== 'CHILD' && (<Badge variant={getRoleBadgeVariant(member.role) as 'default' | 'secondary' | 'outline'} className="mt-1">
                        <RoleIcon className="w-3 h-3 mr-1" />
                        {roleLabel(member.role)}
                      </Badge>)}
                      {viewerIsAdult && member.role === 'CHILD' && (
                        <AccountStatusBadge hasAccount={member.hasAccount ?? !!member.userId} className="mt-1" />
                      )}
                    </div>
                    {family.ownerId === member.userId && (
                      <Badge variant="outline" className="text-xs">Owner</Badge>
                    )}
                    {(member.userId === user?.id ||
                      family.ownerId === user?.id ||
                      family.members?.some(m => m.userId === user?.id && m.role === 'PARENT')) && (
                      <AppearanceButton familyId={family.id} memberId={member.id} name={member.displayName} avatarUrl={member.avatarUrl} color={member.color} emoji={member.emoji} />
                    )}
                    {member.userId === user?.id && member.role !== 'CHILD' && (
                      <FamilyNameButton
                        familyId={family.id}
                        familyName={family.name}
                        nickname={member.nickname ?? ''}
                        accountFirstName={user?.firstName || ''}
                        onSaved={() => mutateFamily()}
                      />
                    )}
                    {(() => {
                      const isSelf = member.userId === user?.id
                      const isMemberOwner = family.ownerId === member.userId
                      const viewerIsAdmin =
                        family.ownerId === user?.id ||
                        family.members?.some(m => m.userId === user?.id && m.role === 'PARENT')
                      if (isMemberOwner) return null
                      if (isSelf) {
                        return (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            onClick={() => setMemberToRemove({ id: member.id, name: member.displayName, isSelf: true })}
                          >
                            <LogOut className="w-4 h-4 mr-1" />
                            Leave
                          </Button>
                        )
                      }
                      if (!viewerIsAdmin) return null
                      return (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setMemberToRemove({ id: member.id, name: member.displayName, isSelf: false, isChild: member.role === 'CHILD' })}
                          aria-label={`Remove ${member.displayName}`}
                        >
                          <UserMinus className="w-4 h-4 mr-1" />
                          Remove
                        </Button>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Children */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Children</CardTitle>
              <CardDescription>
                {family.children?.length || 0} of {access.limits.maxChildren === -1 ? 'unlimited' : access.limits.maxChildren}
              </CardDescription>
            </div>
            <Dialog open={addChildOpen} onOpenChange={(open) => { setAddChildOpen(open); if (!open) setChildConsent(false) }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Child
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add a Child</DialogTitle>
                  <DialogDescription>
                    For kids without their own email: you track their activity from your account. Kids with an email get their own sign-in from Invite &gt; Child.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {/* Toggle between select and create */}
                  <div className="flex gap-2">
                    <Button
                      variant={addMode === 'select' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setAddMode('select')}
                      disabled={unassignedMembers.length === 0}
                    >
                      Select Member
                    </Button>
                    <Button
                      variant={addMode === 'create' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setAddMode('create')}
                    >
                      Create New
                    </Button>
                  </div>

                  {addMode === 'select' && unassignedMembers.length > 0 ? (
                    <>
                      <div className="space-y-2">
                        <Label>Select Family Member</Label>
                        <Select value={selectedMemberId} onValueChange={(val) => {
                          setSelectedMemberId(val)
                          const member = unassignedMembers.find(m => m.memberId === val)
                          if (member) setChildName(member.displayName)
                        }}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a member..." />
                          </SelectTrigger>
                          <SelectContent>
                            {unassignedMembers.map((member) => (
                              <SelectItem key={member.memberId} value={member.memberId}>
                                <div className="flex items-center gap-2">
                                  <span>{member.displayName}</span>
                                  <span className="text-xs text-muted-foreground">({member.email})</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          These members joined your family via invite code but haven&apos;t been assigned as children yet.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="childNameSelect">Display Name (optional)</Label>
                        <Input
                          id="childNameSelect"
                          placeholder="Override display name"
                          value={childName}
                          onChange={(e) => setChildName(e.target.value)}
                        />
                      </div>
                      <BirthdateInput id="childBirthdateSelect" value={childBirthdate} onChange={setChildBirthdate} />
                    </>
                  ) : addMode === 'select' && unassignedMembers.length === 0 ? (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      <p>No unassigned family members.</p>
                      <p className="mt-1">Share your invite code so family members can join, or create a new profile below.</p>
                      <Button
                        variant="link"
                        className="mt-2"
                        onClick={() => setAddMode('create')}
                      >
                        Create New Profile Instead
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="childName">Child Name</Label>
                      <Input
                        id="childName"
                        placeholder="Enter child's name"
                        value={childName}
                        onChange={(e) => setChildName(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        For a child without their own email: no sign-in for them, and you keep track of their activity from your account. To give a child their own sign-in, use Invite &gt; Child.
                      </p>
                      <div className="pt-2">
                        <BirthdateInput id="childBirthdate" value={childBirthdate} onChange={setChildBirthdate} />
                      </div>
                    </div>
                  )}
                  {!(addMode === 'select' && unassignedMembers.length === 0) && (
                    <ChildConsentBox id="add-child-consent" checked={childConsent} onCheckedChange={setChildConsent} />
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => {
                    setAddChildOpen(false)
                    setSelectedMemberId('')
                    setChildName('')
                    setChildBirthdate('')
                    setChildConsent(false)
                  }}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddChild}
                    disabled={isAddingChild || !childConsent || (addMode === 'select' && !selectedMemberId && unassignedMembers.length > 0) || (addMode === 'create' && !childName.trim())}
                  >
                    {isAddingChild ? <Spinner className="w-4 h-4 mr-2" /> : null}
                    {addMode === 'select' && selectedMemberId ? 'Assign as Child' : 'Add Child'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {family.children?.length === 0 ? (
              <div className="text-center py-8">
                <Baby className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No children added yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {family.children?.map((child) => {
                  const initials = child.displayName
                    ?.split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase() || '?'
                    
                  return (
                    <Link
                      key={child.id}
                      href={`/family/child/${child.id}`}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    >
                      <MemberAvatar name={child.displayName} avatarUrl={child.avatarUrl} color={child.color} emoji={child.emoji} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {child.displayName}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {viewerIsAdult && (
                            <AccountStatusBadge hasAccount={child.hasAccount ?? !!child.hasLogin} showHint />
                          )}
                          {child.age != null && (
                            <Badge variant="outline" className="text-xs">
                              Age {child.age}
                            </Badge>
                          )}
                          <Turns18Chip child={child} />
                          {child.permissions?.locationSharingEnabled && access.featureFlags.locationSharing && (
                            <Badge variant="outline" className="text-xs">
                              <MapPin className="w-3 h-3 mr-1" />
                              Location On
                            </Badge>
                          )}
                          {child.grade && (
                            <Badge variant="secondary" className="text-xs">
                              {child.grade}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {viewerIsParent && child.canHaveAccount && child.familyMemberId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={(ev) => {
                            ev.preventDefault()
                            ev.stopPropagation()
                            setAccountChild(child)
                          }}
                        >
                          Invite to sign in
                        </Button>
                      )}
                      {viewerIsParent && child.familyMemberId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          onClick={(ev) => {
                            ev.preventDefault()
                            ev.stopPropagation()
                            setConsentChild({ memberId: child.familyMemberId as string, name: child.displayName })
                          }}
                        >
                          Consent
                        </Button>
                      )}
                      {child.familyMemberId && (
                        <AppearanceButton familyId={family.id} memberId={child.familyMemberId} name={child.displayName} avatarUrl={child.avatarUrl} color={child.color} emoji={child.emoji} />
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
      <ChildAccountDialog familyId={family.id} child={accountChild} onOpenChange={(open) => { if (!open) setAccountChild(null) }} />
      <ChildConsentDialog familyId={family.id} child={consentChild} onOpenChange={(open) => { if (!open) setConsentChild(null) }} onWithdrawn={() => { mutateFamily(); refreshActivities() }} />
    </div>
  )
}
