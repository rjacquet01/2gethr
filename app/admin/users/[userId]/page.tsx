'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { 
  ArrowLeft, User, Mail, Phone, Calendar, Shield, 
  AlertTriangle, CheckCircle, XCircle, Key, UserX, UserCheck,
  Clock, Home, Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  Dialog, DialogContent, DialogDescription, DialogFooter, 
  DialogHeader, DialogTitle 
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

interface UserDetail {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  isActive: boolean
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
  timezone: string | null
  dateOfBirth: string | null
}

interface Family {
  id: string
  name: string
  role: string
  joinedAt: string
  isActive: boolean
  subscriptionTier: string | null
  subscriptionStatus: string | null
}

interface Activity {
  action: string
  entityType: string
  entityId: string
  createdAt: string
  metadata: Record<string, unknown>
}

export default function AdminUserDetailPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params.userId as string
  
  const [user, setUser] = useState<UserDetail | null>(null)
  const [families, setFamilies] = useState<Family[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  
  const [actionDialog, setActionDialog] = useState<{
    type: 'suspend' | 'unsuspend' | 'reset_password' | 'verify_email' | null
    reason: string
  }>({ type: null, reason: '' })
  const [actionLoading, setActionLoading] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  
  useEffect(() => {
    loadUser()
  }, [userId])
  
  async function loadUser() {
    try {
      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/users/${userId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      
      if (!res.ok) {
        toast.error('Failed to load user')
        return
      }
      
      const data = await res.json()
      setUser(data.user)
      setFamilies(data.families || [])
      setActivity(data.recentActivity || [])
    } catch (error) {
      console.error('Error loading user:', error)
      toast.error('Failed to load user')
    } finally {
      setLoading(false)
    }
  }
  
  async function handleAction() {
    if (!actionDialog.type) return
    
    setActionLoading(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: actionDialog.type,
          reason: actionDialog.reason,
        }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        toast.error(data.error || 'Action failed')
        return
      }
      
      toast.success(data.message)
      
      if (data.tempPassword) {
        setTempPassword(data.tempPassword)
      } else {
        setActionDialog({ type: null, reason: '' })
        loadUser()
      }
    } catch {
      toast.error('Action failed')
    } finally {
      setActionLoading(false)
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
  
  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">User not found</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/admin/users')}>
          Back to Users
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
            <Link href="/admin/users">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{user.firstName} {user.lastName}</h1>
            <p className="text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user.isActive ? (
            <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Active</Badge>
          ) : (
            <Badge variant="destructive">Suspended</Badge>
          )}
          {user.emailVerified ? (
            <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Verified</Badge>
          ) : (
            <Badge variant="outline">Unverified</Badge>
          )}
        </div>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        {/* User Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              User Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="flex items-start gap-2 min-w-0">
                  <Mail className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="break-all min-w-0">{user.email}</span>
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="flex items-start gap-2 min-w-0">
                  <Phone className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="break-words min-w-0">{user.phone || 'Not set'}</span>
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="flex items-start gap-2 min-w-0">
                  <Calendar className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="min-w-0">{new Date(user.createdAt).toLocaleDateString()}</span>
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Last Login</p>
                <p className="flex items-start gap-2 min-w-0">
                  <Clock className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="break-words min-w-0">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Admin Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Admin Actions
            </CardTitle>
            <CardDescription>Manage this user account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={() => setActionDialog({ type: 'reset_password', reason: '' })}
            >
              <Key className="h-4 w-4 mr-2" />
              Reset Password
            </Button>
            
            {!user.emailVerified && (
              <Button 
                variant="outline" 
                className="w-full justify-start"
                onClick={() => setActionDialog({ type: 'verify_email', reason: '' })}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Mark Email Verified
              </Button>
            )}
            
            {user.isActive ? (
              <Button 
                variant="outline" 
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={() => setActionDialog({ type: 'suspend', reason: '' })}
              >
                <UserX className="h-4 w-4 mr-2" />
                Suspend User
              </Button>
            ) : (
              <Button 
                variant="outline" 
                className="w-full justify-start text-green-600 hover:text-green-600"
                onClick={() => setActionDialog({ type: 'unsuspend', reason: '' })}
              >
                <UserCheck className="h-4 w-4 mr-2" />
                Unsuspend User
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Families */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-5 w-5" />
            Family Memberships ({families.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {families.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No family memberships</p>
          ) : (
            <div className="space-y-3">
              {families.map(family => (
                <div key={family.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <Link href={`/admin/families/${family.id}`} className="font-medium hover:underline">
                      {family.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {family.role} · Joined {new Date(family.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {family.subscriptionTier && (
                      <Badge variant="outline">{family.subscriptionTier}</Badge>
                    )}
                    {family.isActive ? (
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
      
      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No recent activity</p>
          ) : (
            <div className="space-y-2">
              {activity.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{item.action}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.entityType} · {item.entityId}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Action Dialog */}
      <Dialog open={!!actionDialog.type && !tempPassword} onOpenChange={(open) => !open && setActionDialog({ type: null, reason: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog.type === 'suspend' && 'Suspend User'}
              {actionDialog.type === 'unsuspend' && 'Unsuspend User'}
              {actionDialog.type === 'reset_password' && 'Reset Password'}
              {actionDialog.type === 'verify_email' && 'Verify Email'}
            </DialogTitle>
            <DialogDescription>
              {actionDialog.type === 'suspend' && 'This will prevent the user from accessing their account.'}
              {actionDialog.type === 'unsuspend' && 'This will restore the user\'s access to their account.'}
              {actionDialog.type === 'reset_password' && 'This will generate a temporary password for the user.'}
              {actionDialog.type === 'verify_email' && 'This will mark the user\'s email as verified.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Textarea 
              value={actionDialog.reason}
              onChange={(e) => setActionDialog(prev => ({ ...prev, reason: e.target.value }))}
              placeholder="Enter reason for this action..."
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog({ type: null, reason: '' })}>
              Cancel
            </Button>
            <Button 
              onClick={handleAction}
              disabled={actionLoading}
              variant={actionDialog.type === 'suspend' ? 'destructive' : 'default'}
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Temp Password Dialog */}
      <Dialog open={!!tempPassword} onOpenChange={() => { setTempPassword(null); setActionDialog({ type: null, reason: '' }); loadUser(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Password Reset Successful
            </DialogTitle>
            <DialogDescription>
              Share this temporary password with the user securely. They should change it immediately after logging in.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="p-4 bg-muted rounded-lg font-mono text-center text-lg">
              {tempPassword}
            </div>
            <Button 
              variant="outline" 
              className="w-full mt-4"
              onClick={() => {
                navigator.clipboard.writeText(tempPassword || '')
                toast.success('Copied to clipboard')
              }}
            >
              Copy to Clipboard
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => { setTempPassword(null); setActionDialog({ type: null, reason: '' }); loadUser(); }}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
