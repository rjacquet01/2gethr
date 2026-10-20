'use client'

import { useEffect, useState } from 'react'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { CreditCard, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { TRIAL_DAYS } from '@/lib/subscription-tiers'
import { planName, describeTierCount, type TierBreakdown } from '@/lib/admin-tier-breakdown'

interface SubscriptionData {
  id: string
  familyId: string
  familyName: string
  ownerEmail: string
  tier: string
  status: string
  memberCount: number
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
  createdAt: string
}

const tierColors: Record<string, string> = {
  FREE: 'bg-muted text-muted-foreground',
  PREMIUM: 'bg-info text-info-foreground',
  PREMIUM_PLUS: 'bg-primary text-primary-foreground',
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-success text-success-foreground',
  TRIALING: 'bg-info text-info-foreground',
  PAST_DUE: 'bg-warning text-warning-foreground',
  CANCELLED: 'bg-destructive text-destructive-foreground',
  EXPIRED: 'bg-muted text-muted-foreground',
}

export default function AdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionData[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [stats, setStats] = useState<{ byTier: Partial<TierBreakdown> }>({ byTier: {} })
  const [loading, setLoading] = useState(true)
  const [tier, setTier] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  
  // Action dialog state
  const [actionDialog, setActionDialog] = useState<{
    open: boolean
    subscription: SubscriptionData | null
    action: string
  }>({ open: false, subscription: null, action: '' })
  const [actionReason, setActionReason] = useState('')
  const [trialDays, setTrialDays] = useState(String(TRIAL_DAYS))
  const [newTier, setNewTier] = useState('PREMIUM')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    loadSubscriptions()
  }, [pagination.page, tier, status])

  async function loadSubscriptions() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: '20',
      })
      if (tier !== 'all') params.set('tier', tier)
      if (status !== 'all') params.set('status', status)

      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/subscriptions?${params}`, { 
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setSubscriptions(data.subscriptions)
        setPagination(data.pagination)
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Failed to load subscriptions:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAction() {
    if (!actionDialog.subscription) return
    setActionLoading(true)
    
    try {
      const body: Record<string, unknown> = {
        action: actionDialog.action,
        reason: actionReason,
      }
      
      if (actionDialog.action === 'grant_trial') {
        body.trialDays = parseInt(trialDays)
      }
      if (actionDialog.action === 'change_tier') {
        body.tier = newTier
      }
      
      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/subscriptions/${actionDialog.subscription.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      
      if (res.ok) {
        toast.success('Subscription updated')
        setActionDialog({ open: false, subscription: null, action: '' })
        setActionReason('')
        loadSubscriptions()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        <p className="text-muted-foreground">Manage family subscription plans</p>
      </div>

      {/* Quick stats */}
      <div className="flex flex-wrap gap-2">
        {(['PREMIUM_PLUS', 'PREMIUM', 'FREE'] as const).map((t) => (
          <Badge key={t} variant="outline" className="px-3 py-1">
            {planName(t)}: {describeTierCount(t, stats.byTier?.[t])}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <Select value={tier} onValueChange={(v) => { setTier(v); setPagination(p => ({ ...p, page: 1 })) }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="PREMIUM_PLUS">{planName('PREMIUM_PLUS')}</SelectItem>
                <SelectItem value="PREMIUM">{planName('PREMIUM')}</SelectItem>
                <SelectItem value="FREE">{planName('FREE')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPagination(p => ({ ...p, page: 1 })) }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="TRIALING">Trialing</SelectItem>
                <SelectItem value="PAST_DUE">Past Due</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
              No subscriptions found
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Family</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Period End</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium">{sub.familyName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {sub.ownerEmail}
                      </TableCell>
                      <TableCell>
                        <Badge className={tierColors[sub.tier]}>{planName(sub.tier)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[sub.status]}>{sub.status}</Badge>
                      </TableCell>
                      <TableCell>{sub.memberCount}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {sub.currentPeriodEnd 
                          ? new Date(sub.currentPeriodEnd).toLocaleDateString()
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setActionDialog({
                              open: true,
                              subscription: sub,
                              action: 'grant_trial'
                            })}
                          >
                            Grant Trial
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setActionDialog({
                              open: true,
                              subscription: sub,
                              action: 'change_tier'
                            })}
                          >
                            Change Tier
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total} subscriptions
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === 1}
                    onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog 
        open={actionDialog.open} 
        onOpenChange={(open) => !open && setActionDialog({ open: false, subscription: null, action: '' })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog.action === 'grant_trial' && 'Grant Trial'}
              {actionDialog.action === 'change_tier' && 'Change Subscription Tier'}
            </DialogTitle>
            <DialogDescription>
              {actionDialog.subscription?.familyName} - {actionDialog.subscription?.ownerEmail}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {actionDialog.action === 'grant_trial' && (
              <div className="space-y-2">
                <Label>Trial Days</Label>
                <Input
                  type="number"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  min={1}
                  max={90}
                />
              </div>
            )}
            
            {actionDialog.action === 'change_tier' && (
              <div className="space-y-2">
                <Label>New Tier</Label>
                <Select value={newTier} onValueChange={setNewTier}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PREMIUM_PLUS">{planName('PREMIUM_PLUS')}</SelectItem>
                    <SelectItem value="PREMIUM">{planName('PREMIUM')}</SelectItem>
                    <SelectItem value="FREE">{planName('FREE')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>Reason (for audit)</Label>
              <Textarea
                placeholder="Customer request, support ticket #, etc."
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActionDialog({ open: false, subscription: null, action: '' })}
            >
              Cancel
            </Button>
            <Button onClick={handleAction} disabled={actionLoading}>
              {actionLoading ? 'Processing...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
