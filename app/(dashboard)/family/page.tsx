'use client'

import { useState } from 'react'
import { useFamilies, useFamily } from '@/hooks/use-family'
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
  LogOut
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import Link from 'next/link'
import { MemberAvatar, AppearanceButton } from '@/components/member-avatar'
import { JoinFamilyButton } from '@/components/join-family-dialog'

export default function FamilyPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  const { user } = useAuth()
  const { family, generateInviteCode, addChild, removeMember, isLoading: familyLoading } = useFamily(primaryFamily?.id || null)
  const { access } = useSubscription(primaryFamily?.id || null)
  
  const [copiedCode, setCopiedCode] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAddingChild, setIsAddingChild] = useState(false)
  const [addChildOpen, setAddChildOpen] = useState(false)
  const [childName, setChildName] = useState('')
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [addMode, setAddMode] = useState<'select' | 'create'>('select')
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set())

  const [memberToRemove, setMemberToRemove] = useState<{ id: string; name: string; isSelf: boolean } | null>(null)
  const [isRemovingMember, setIsRemovingMember] = useState(false)

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return
    setIsRemovingMember(true)
    const result = await removeMember(memberToRemove.id)
    setIsRemovingMember(false)
    if (result.success) {
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
  }

  const { data: memberActivities = [], isLoading: activitiesLoading } = useSWR<MemberActivity[]>(
    primaryFamily?.id ? `/api/families/${primaryFamily.id}/member-activities` : null,
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
      })
      
      if (result.success) {
        toast.success('Member assigned as child successfully!')
        setChildName('')
        setSelectedMemberId('')
        setAddChildOpen(false)
        mutateUnassigned()
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
    const result = await addChild({ displayName: childName })
    
    if (result.success) {
      toast.success('Child added successfully!')
      setChildName('')
      setAddChildOpen(false)
    } else {
      toast.error(result.error || 'Failed to add child')
    }
    
    setIsAddingChild(false)
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'PARENT': return Crown
      case 'GUARDIAN': return Shield
      case 'CHILD': return Baby
      default: return Users
    }
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'PARENT': return 'default'
      case 'GUARDIAN': return 'secondary'
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

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{family.name}</h1>
          <p className="text-muted-foreground">Manage your family members</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <JoinFamilyButton />
          <Button variant="outline" asChild>
            <Link href="/family/settings">
              <Settings className="w-4 h-4 mr-2" />
              Family Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* Invite Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Invite Family Members
          </CardTitle>
          <CardDescription>
            Share this code with family members to invite them
          </CardDescription>
        </CardHeader>
        <CardContent>
          {family.inviteCode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 p-3 rounded-lg bg-muted font-mono text-lg tracking-wider text-center">
                  {family.inviteCode}
                </div>
                <Button variant="outline" size="icon" onClick={handleCopyCode} title="Copy code">
                  {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="default">
                      <Share2 className="w-4 h-4 mr-2" />
                      Share Invite
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={handleShareEmail}>
                      <Mail className="w-4 h-4 mr-2" />
                      Share via Email
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleShareSMS}>
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Share via Text
                    </DropdownMenuItem>
                    {typeof navigator !== 'undefined' && navigator.share && (
                      <DropdownMenuItem onClick={handleShareNative}>
                        <Share2 className="w-4 h-4 mr-2" />
                        More Options...
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" onClick={handleGenerateInviteCode} disabled={isGenerating}>
                  {isGenerating ? <Spinner className="w-4 h-4 mr-2" /> : null}
                  New Code
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={handleGenerateInviteCode} disabled={isGenerating}>
              {isGenerating ? <Spinner className="w-4 h-4 mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Generate Invite Code
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Member Activities Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ListTodo className="w-5 h-5" />
            Family Member Activities
          </CardTitle>
          <CardDescription>
            View tasks and upcoming events for each family member
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : memberActivities.length === 0 ? (
            <Empty
              title="No activities yet"
              description="Tasks and events will appear here when assigned to family members"
            />
          ) : (
            <div className="space-y-4">
              {memberActivities.map((member) => {
                const RoleIcon = getRoleIcon(member.role)
                const initials = member.displayName
                  ?.split(' ')
                  .map(n => n[0])
                  .join('')
                  .toUpperCase() || '?'

                return (
                  <div
                    key={member.memberId}
                    className="border rounded-lg overflow-hidden"
                  >
                    {/* Member Header - clickable to expand/collapse */}
                    <button
                      onClick={() => toggleMemberExpanded(member.memberId)}
                      className="flex items-center gap-3 p-3 bg-muted/30 w-full text-left hover:bg-muted/50 transition-colors"
                    >
                      <MemberAvatar name={member.displayName} avatarUrl={member.avatarUrl} color={member.color} emoji={member.emoji} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {member.displayName}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={getRoleBadgeVariant(member.role) as 'default' | 'secondary' | 'outline'} className="text-xs">
                            <RoleIcon className="w-3 h-3 mr-1" />
                            {member.role}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {member.taskCount} tasks, {member.eventCount} events
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {member.childProfileId && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            asChild
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link href={`/family/child/${member.childProfileId}`}>
                              <Settings className="w-4 h-4" />
                            </Link>
                          </Button>
                        )}
                        {expandedMembers.has(member.memberId) ? (
                          <ChevronUp className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {/* Tasks and Events - shown when expanded */}
                    {expandedMembers.has(member.memberId) && (member.tasks.length > 0 || member.events.length > 0) && (
                      <Tabs defaultValue="tasks" className="w-full">
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
                      </Tabs>
                    )}

                    {/* No activities message - shown when expanded */}
                    {expandedMembers.has(member.memberId) && member.tasks.length === 0 && member.events.length === 0 && (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <AlertCircle className="w-5 h-5 mx-auto mb-2 opacity-50" />
                        No tasks or events assigned
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => { if (!open && !isRemovingMember) setMemberToRemove(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberToRemove?.isSelf ? 'Leave this family?' : `Remove ${memberToRemove?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {memberToRemove?.isSelf
                ? 'You will lose access to this family\'s calendar, tasks and locations. You can rejoin later with a new invite code.'
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

      <div className="grid gap-6 lg:grid-cols-2">
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
                      </p>
                      <Badge variant={getRoleBadgeVariant(member.role) as 'default' | 'secondary' | 'outline'} className="mt-1">
                        <RoleIcon className="w-3 h-3 mr-1" />
                        {member.role}
                      </Badge>
                    </div>
                    {family.ownerId === member.userId && (
                      <Badge variant="outline" className="text-xs">Owner</Badge>
                    )}
                    {(member.userId === user?.id ||
                      family.ownerId === user?.id ||
                      family.members?.some(m => m.userId === user?.id && m.role === 'PARENT')) && (
                      <AppearanceButton familyId={family.id} memberId={member.id} name={member.displayName} avatarUrl={member.avatarUrl} color={member.color} emoji={member.emoji} />
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
                          onClick={() => setMemberToRemove({ id: member.id, name: member.displayName, isSelf: false })}
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
            <Dialog open={addChildOpen} onOpenChange={setAddChildOpen}>
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
                    Select an existing family member or create a new child profile.
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
                        This creates a child profile without a linked user account. The child won&apos;t be able to log in.
                      </p>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => {
                    setAddChildOpen(false)
                    setSelectedMemberId('')
                    setChildName('')
                  }}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleAddChild} 
                    disabled={isAddingChild || (addMode === 'select' && !selectedMemberId && unassignedMembers.length > 0) || (addMode === 'create' && !childName.trim())}
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
                        <div className="flex items-center gap-2 mt-1">
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
  )
}
