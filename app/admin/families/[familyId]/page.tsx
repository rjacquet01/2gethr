'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import {
  ArrowLeft, Users, Mail, Calendar, Crown, Baby,
  AlertTriangle, History, Home
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface FamilyDetail {
  id: string
  name: string
  createdAt: string
  owner: {
    id: string | null
    email: string | null
    firstName: string | null
    lastName: string | null
  }
}

interface Member {
  id: string
  userId: string
  email: string
  firstName: string
  lastName: string
  role: string
  joinedAt: string
  isActive: boolean
  canCreateEvents: boolean
  requiresEventApproval: boolean
}

interface Child {
  id: string
  memberId: string
  displayName: string
  age: number | null
  school: string | null
  grade: string | null
  hasLogin: boolean
}

interface Subscription {
  id: string
  tier: string
  status: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
}

interface SubscriptionHistoryEntry {
  id: string
  oldStatus: string | null
  newStatus: string
  source: string | null
  adminEmail: string | null
  notes: string | null
  changedAt: string
}

interface RiskFlag {
  id: string
  type: string
  severity: string
  status: string
  description: string
  reviewedByEmail: string | null
  reviewedAt: string | null
  resolutionNotes: string | null
  createdAt: string
}

function getTierBadgeVariant(tier: string) {
  switch (tier) {
    case 'PREMIUM_PLUS': return 'default'
    case 'PREMIUM': return 'secondary'
    default: return 'outline'
  }
}

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case 'ACTIVE': return 'default'
    case 'TRIALING': return 'secondary'
    case 'PAST_DUE': return 'destructive'
    default: return 'outline'
  }
}

export default function AdminFamilyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const familyId = params.familyId as string

  const [family, setFamily] = useState<FamilyDetail | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [subscriptionHistory, setSubscriptionHistory] = useState<SubscriptionHistoryEntry[]>([])
  const [riskFlags, setRiskFlags] = useState<RiskFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Delete a child profile with no login (docs/COPPA_RUNBOOK.md).
  const [deleteChild, setDeleteChild] = useState<Child | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function openDelete(child: Child) {
    setDeleteChild(child)
    setDeleteReason('')
    setDeleteConfirm('')
    setDeleteError(null)
  }

  async function confirmDeleteChild() {
    if (!deleteChild) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/families/${familyId}/children/${deleteChild.memberId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ reason: deleteReason, confirm: deleteConfirm }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setDeleteError(data?.error || 'Failed to delete child profile')
        return
      }
      setDeleteChild(null)
      await loadFamily()
    } catch {
      setDeleteError('Failed to delete child profile')
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    loadFamily()
  }, [familyId])

  async function loadFamily() {
    setLoading(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/families/${familyId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (res.status === 404) {
        setNotFound(true)
        return
      }

      if (!res.ok) {
        setNotFound(true)
        return
      }

      const data = await res.json()
      setFamily(data.family)
      setMembers(data.members || [])
      setChildren(data.children || [])
      setSubscription(data.subscription || null)
      setSubscriptionHistory(data.subscriptionHistory || [])
      setRiskFlags(data.riskFlags || [])
    } catch (error) {
      console.error('Error loading family:', error)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (notFound || !family) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Family not found</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/admin/families')}>
          Back to Families
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/families">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{family.name}</h1>
            <p className="text-muted-foreground">
              Created {new Date(family.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        {subscription && (
          <div className="flex items-center gap-2">
            <Badge variant={getTierBadgeVariant(subscription.tier)}>
              {subscription.tier === 'PREMIUM_PLUS' && <Crown className="h-3 w-3 mr-1" />}
              {subscription.tier?.replace('_', ' ') || 'FREE'}
            </Badge>
            <Badge variant={getStatusBadgeVariant(subscription.status)}>
              {subscription.status}
            </Badge>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Owner Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Family Owner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p>{family.owner.firstName} {family.owner.lastName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {family.owner.email || 'Unknown'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5" />
              Subscription
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {subscription ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Current Period</p>
                  <p className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {subscription.currentPeriodStart
                      ? new Date(subscription.currentPeriodStart).toLocaleDateString()
                      : '—'}
                    {' – '}
                    {subscription.currentPeriodEnd
                      ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
                {subscription.trialEndsAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Trial Ends</p>
                    <p>{new Date(subscription.trialEndsAt).toLocaleDateString()}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Cancels at Period End</p>
                  <p>{subscription.cancelAtPeriodEnd ? 'Yes' : 'No'}</p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No subscription on file</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Family Members ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No members</p>
          ) : (
            <div className="space-y-3">
              {members.map(member => (
                <div key={member.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <Link href={`/admin/users/${member.userId}`} className="font-medium hover:underline">
                      {member.firstName} {member.lastName}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {member.email} · Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{member.role}</Badge>
                    {member.isActive ? (
                      <Badge className="bg-green-500/10 text-green-600">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Children */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Baby className="h-5 w-5" />
            Children ({children.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {children.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No children on file</p>
          ) : (
            <div className="space-y-3">
              {children.map(child => (
                <div key={child.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{child.displayName}</p>
                    <p className="text-sm text-muted-foreground">
                      {child.age !== null ? `Age ${child.age}` : 'Age unknown'}
                      {child.school ? ` · ${child.school}` : ''}
                      {child.grade ? ` · Grade ${child.grade}` : ''}
                      {child.hasLogin ? ' · Has own login' : ''}
                    </p>
                  </div>
                  {!child.hasLogin && (
                    <Button variant="destructive" size="sm" onClick={() => openDelete(child)}>
                      Delete child profile
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subscription History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Subscription History
          </CardTitle>
          <CardDescription>Recent status changes</CardDescription>
        </CardHeader>
        <CardContent>
          {subscriptionHistory.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No subscription history</p>
          ) : (
            <div className="space-y-2">
              {subscriptionHistory.map(entry => (
                <div key={entry.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">
                      {entry.oldStatus ? `${entry.oldStatus} → ${entry.newStatus}` : entry.newStatus}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {entry.source || 'system'}
                      {entry.adminEmail ? ` · ${entry.adminEmail}` : ''}
                      {entry.notes ? ` · ${entry.notes}` : ''}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(entry.changedAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Risk Flags */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Risk Flags ({riskFlags.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {riskFlags.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No risk flags</p>
          ) : (
            <div className="space-y-3">
              {riskFlags.map(flag => (
                <div key={flag.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{flag.type}</p>
                    <p className="text-sm text-muted-foreground">{flag.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={flag.severity === 'HIGH' ? 'destructive' : 'outline'}>
                      {flag.severity}
                    </Badge>
                    <Badge variant="secondary">{flag.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deleteChild} onOpenChange={(open) => { if (!open && !deleting) setDeleteChild(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteChild?.displayName}&apos;s child profile?</DialogTitle>
            <DialogDescription>
              Permanently deletes this child&apos;s profile (name, birthdate, school, notes), location settings and place
              assignments. Any parental consent record is kept and marked withdrawn by you. Other family members are
              not affected. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="delete-child-reason">Reason (required)</Label>
              <Textarea
                id="delete-child-reason"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="e.g. Parent request by email on 2026-10-20, verified from the address on file"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delete-child-confirm">Type DELETE to confirm</Label>
              <Input id="delete-child-confirm" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} autoComplete="off" />
            </div>
            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteChild(null)} disabled={deleting}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteChild}
              disabled={deleting || deleteConfirm !== 'DELETE' || !deleteReason.trim()}
            >
              {deleting ? 'Deleting...' : 'Delete child profile'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
