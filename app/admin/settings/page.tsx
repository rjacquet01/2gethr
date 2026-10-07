'use client'

import { useEffect, useState } from 'react'
import { Settings, Lock, User, Shield, History, Plus, Trash2, Loader2, CreditCard, Check, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'

interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  status: string
  roles: string[]
  permissions: string[]
  createdAt: string
  lastLoginAt: string | null
}

interface AuditLog {
  id: string
  action: string
  targetType: string
  targetId: string
  details: Record<string, unknown>
  ipAddress: string
  createdAt: string
}

interface OtherAdmin {
  id: string
  email: string
  firstName: string
  lastName: string
  status: string
  roles: { name: string }[]
  createdAt: string
  lastLoginAt: string | null
}

interface PaymentGateway {
  id: string
  provider: string
  display_name: string
  is_active: boolean
  merchant_id: string
  api_endpoint: string | null
  created_at: string
  updated_at: string
}

export default function AdminSettingsPage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [otherAdmins, setOtherAdmins] = useState<OtherAdmin[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  
  // Profile update state
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [updatingProfile, setUpdatingProfile] = useState(false)
  
  // New admin dialog state
  const [showNewAdminDialog, setShowNewAdminDialog] = useState(false)
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminFirstName, setNewAdminFirstName] = useState('')
  const [newAdminLastName, setNewAdminLastName] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [newAdminRole, setNewAdminRole] = useState('ADMIN')
  const [creatingAdmin, setCreatingAdmin] = useState(false)

  // Payment gateway state
  const [paymentGateways, setPaymentGateways] = useState<PaymentGateway[]>([])
  const [loadingGateways, setLoadingGateways] = useState(false)
  const [showGatewayDialog, setShowGatewayDialog] = useState(false)
  const [savingGateway, setSavingGateway] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showApiSecret, setShowApiSecret] = useState(false)
  
  // Gateway form state
  const [gatewayName, setGatewayName] = useState('amex')
  const [gatewayDisplayName, setGatewayDisplayName] = useState('American Express')
  const [merchantId, setMerchantId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [apiEndpoint, setApiEndpoint] = useState('https://api.americanexpress.com/payments/v1')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [gatewayActive, setGatewayActive] = useState(true)
  const [gatewayDefault, setGatewayDefault] = useState(true)

  useEffect(() => {
    loadAdminProfile()
  }, [])

  async function loadAdminProfile() {
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/auth/me', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setAdmin(data.admin)
        setFirstName(data.admin.firstName || '')
        setLastName(data.admin.lastName || '')
      }
    } catch (error) {
      console.error('Failed to load admin profile:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadAuditLogs() {
    setLoadingLogs(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/settings/audit-logs', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setAuditLogs(data.logs || [])
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error)
    } finally {
      setLoadingLogs(false)
    }
  }

  async function loadOtherAdmins() {
    setLoadingAdmins(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/settings/admins', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setOtherAdmins(data.admins || [])
      }
    } catch (error) {
      console.error('Failed to load admins:', error)
    } finally {
      setLoadingAdmins(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    
    setChangingPassword(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/settings/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      
      const data = await res.json()
      if (res.ok) {
        toast.success('Password changed successfully')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        toast.error(data.error || 'Failed to change password')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setChangingPassword(false)
    }
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault()
    setUpdatingProfile(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/settings/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ firstName, lastName }),
      })
      
      const data = await res.json()
      if (res.ok) {
        toast.success('Profile updated successfully')
        setAdmin(prev => prev ? { ...prev, firstName, lastName } : null)
      } else {
        toast.error(data.error || 'Failed to update profile')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setUpdatingProfile(false)
    }
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault()
    if (newAdminPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    
    setCreatingAdmin(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/settings/admins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          email: newAdminEmail,
          firstName: newAdminFirstName,
          lastName: newAdminLastName,
          password: newAdminPassword,
          role: newAdminRole,
        }),
      })
      
      const data = await res.json()
      if (res.ok) {
        toast.success('Admin created successfully')
        setShowNewAdminDialog(false)
        setNewAdminEmail('')
        setNewAdminFirstName('')
        setNewAdminLastName('')
        setNewAdminPassword('')
        setNewAdminRole('ADMIN')
        loadOtherAdmins()
      } else {
        toast.error(data.error || 'Failed to create admin')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setCreatingAdmin(false)
    }
  }

  async function handleDeactivateAdmin(adminId: string) {
    if (!confirm('Are you sure you want to deactivate this admin?')) return
    
    try {
      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/settings/admins/${adminId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      
      if (res.ok) {
        toast.success('Admin deactivated')
        loadOtherAdmins()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to deactivate admin')
      }
    } catch {
      toast.error('An error occurred')
    }
  }

  const loadPaymentGateways = async () => {
    setLoadingGateways(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/payment-gateway', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setPaymentGateways(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load payment gateways:', error)
    } finally {
      setLoadingGateways(false)
    }
  }

  const handleSaveGateway = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!merchantId.trim()) {
      toast.error('Merchant ID is required')
      return
    }
    
    setSavingGateway(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/payment-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          gatewayName,
          displayName: gatewayDisplayName,
          merchantId: merchantId.trim(),
          apiKey: apiKey.trim() || null,
          apiSecret: apiSecret.trim() || null,
          apiEndpoint: apiEndpoint.trim() || null,
          webhookUrl: webhookUrl.trim() || null,
          webhookSecret: webhookSecret.trim() || null,
          isActive: gatewayActive,
          isDefault: gatewayDefault,
          supportedCardTypes: gatewayName === 'amex' 
            ? ['amex'] 
            : ['visa', 'mastercard', 'amex', 'discover'],
        }),
      })

      const data = await res.json()
      
      if (res.ok) {
        toast.success(data.message || 'Payment gateway saved')
        setShowGatewayDialog(false)
        loadPaymentGateways()
        // Reset form
        setMerchantId('')
        setApiKey('')
        setApiSecret('')
        setWebhookSecret('')
      } else {
        toast.error(data.error || 'Failed to save payment gateway')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setSavingGateway(false)
    }
  }

  const handleDeleteGateway = async (gateway: string) => {
    if (!confirm('Are you sure you want to remove this payment gateway?')) return
    
    try {
      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/payment-gateway?gateway=${gateway}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      
      if (res.ok) {
        toast.success('Payment gateway removed')
        loadPaymentGateways()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to remove payment gateway')
      }
    } catch {
      toast.error('An error occurred')
    }
  }

  const isSuperAdmin = admin?.roles?.includes('SUPER_ADMIN')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8" />
        <div>
          <h1 className="text-2xl font-bold">Admin Settings</h1>
          <p className="text-muted-foreground">Manage your account and admin settings</p>
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2" onClick={loadAuditLogs}>
            <History className="h-4 w-4" />
            Activity Log
          </TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="admins" className="flex items-center gap-2" onClick={loadOtherAdmins}>
              <Shield className="h-4 w-4" />
              Manage Admins
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your admin profile details</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateProfile} className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={admin?.email || ''} disabled className="bg-muted" />
                  <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Roles</Label>
                  <div className="flex flex-wrap gap-2">
                    {admin?.roles?.map(role => (
                      <Badge key={role} variant={role === 'SUPER_ADMIN' ? 'default' : 'secondary'}>
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button type="submit" disabled={updatingProfile}>
                  {updatingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your admin account password</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <Button type="submit" disabled={changingPassword}>
                  {changingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Change Password
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Your Activity Log</CardTitle>
              <CardDescription>Recent actions performed by your admin account</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingLogs ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : auditLogs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No activity logs found</p>
              ) : (
                <div className="space-y-4">
                  {auditLogs.map(log => (
                    <div key={log.id} className="flex items-start justify-between border-b pb-4 last:border-0">
                      <div>
                        <p className="font-medium">{log.action.replace(/_/g, ' ')}</p>
                        <p className="text-sm text-muted-foreground">
                          {log.targetType}: {log.targetId}
                        </p>
                        {log.ipAddress && (
                          <p className="text-xs text-muted-foreground">IP: {log.ipAddress}</p>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="admins">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Manage Admin Accounts</CardTitle>
                  <CardDescription>Create and manage other admin users</CardDescription>
                </div>
                <Dialog open={showNewAdminDialog} onOpenChange={setShowNewAdminDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Admin
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Admin</DialogTitle>
                      <DialogDescription>Add a new administrator account</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateAdmin} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="newAdminEmail">Email</Label>
                        <Input
                          id="newAdminEmail"
                          type="email"
                          value={newAdminEmail}
                          onChange={(e) => setNewAdminEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="newAdminFirstName">First Name</Label>
                          <Input
                            id="newAdminFirstName"
                            value={newAdminFirstName}
                            onChange={(e) => setNewAdminFirstName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newAdminLastName">Last Name</Label>
                          <Input
                            id="newAdminLastName"
                            value={newAdminLastName}
                            onChange={(e) => setNewAdminLastName(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="newAdminPassword">Password</Label>
                        <Input
                          id="newAdminPassword"
                          type="password"
                          value={newAdminPassword}
                          onChange={(e) => setNewAdminPassword(e.target.value)}
                          required
                          minLength={8}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="newAdminRole">Role</Label>
                        <Select value={newAdminRole} onValueChange={setNewAdminRole}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                            <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
                            <SelectItem value="SUPPORT">Support</SelectItem>
                            <SelectItem value="ANALYST">Analyst</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setShowNewAdminDialog(false)}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={creatingAdmin}>
                          {creatingAdmin && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Create Admin
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingAdmins ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : otherAdmins.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No other admin accounts found</p>
                ) : (
                  <div className="space-y-4">
                    {otherAdmins.map(otherAdmin => (
                      <div key={otherAdmin.id} className="flex items-center justify-between border rounded-lg p-4">
                        <div>
                          <p className="font-medium">{otherAdmin.firstName} {otherAdmin.lastName}</p>
                          <p className="text-sm text-muted-foreground">{otherAdmin.email}</p>
                          <div className="flex gap-2 mt-1">
                            {otherAdmin.roles?.map(role => (
                              <Badge key={role.name} variant="secondary" className="text-xs">
                                {role.name}
                              </Badge>
                            ))}
                            <Badge variant={otherAdmin.status === 'ACTIVE' ? 'default' : 'destructive'} className="text-xs">
                              {otherAdmin.status}
                            </Badge>
                          </div>
                        </div>
                        {otherAdmin.id !== admin?.id && otherAdmin.status === 'ACTIVE' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeactivateAdmin(otherAdmin.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

      </Tabs>
    </div>
  )
}
