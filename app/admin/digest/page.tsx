'use client'

import { useEffect, useState } from 'react'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { 
  Mail, Send, Clock, Users, Calendar, CheckCircle, 
  AlertCircle, RefreshCw, TestTube, ArrowLeft
} from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'

interface DigestStats {
  eligibleUsers: number
  users: Array<{
    id: string
    email: string
    first_name: string
    last_name: string
    phone: string | null
    last_login_at: string | null
    family_name: string
    family_id: string
    role: 'PARENT' | 'GUARDIAN'
    digest_enabled: boolean | null
  }>
  lastSent: string | null
  lastSentBy: string | null
  preview: {
    weekStart: string
    weekEnd: string
    upcomingEventsCount: number
  }
}

interface SendResult {
  total: number
  sent: number
  failed: number
  details: Array<{
    email: string
    status: string
    events: number
  }>
}

// Auto-refresh interval: 8 hours (3 times per day)
const AUTO_REFRESH_INTERVAL = 8 * 60 * 60 * 1000 // 8 hours in milliseconds

export default function AdminDigestPage() {
  const [stats, setStats] = useState<DigestStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [sendResult, setSendResult] = useState<SendResult | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [nextRefresh, setNextRefresh] = useState<Date | null>(null)

  const loadStats = async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/weekly-digest', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setStats(data.data)
        setLastUpdated(new Date())
        setNextRefresh(new Date(Date.now() + AUTO_REFRESH_INTERVAL))
      } else {
        toast.error(data.error || 'Failed to load digest statistics')
      }
    } catch (error) {
      console.error('Failed to load digest stats:', error)
      toast.error('Failed to load digest statistics')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  const handleManualRefresh = () => {
    loadStats(true)
    toast.success('Refreshing eligible recipients list...')
  }

  // Initial load and auto-refresh setup
  useEffect(() => {
    loadStats()
    
    // Set up auto-refresh interval (every 8 hours = 3 times per day)
    const intervalId = setInterval(() => {
      loadStats(true)
      toast.info('Auto-refreshed eligible recipients list')
    }, AUTO_REFRESH_INTERVAL)
    
    return () => clearInterval(intervalId)
  }, [])

  const handleSendTest = async () => {
    if (!testEmail) {
      toast.error('Please enter a test email address')
      return
    }

    setSending(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/weekly-digest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ testMode: true, testEmail }),
      })

      const data = await res.json()
      if (data.success) {
        toast.success(`Test digest sent to ${testEmail}`)
        setSendResult(data.results)
        setShowResultDialog(true)
      } else {
        toast.error(data.error || 'Failed to send test digest')
      }
    } catch (error) {
      console.error('Failed to send test digest:', error)
      toast.error('Failed to send test digest')
    } finally {
      setSending(false)
    }
  }

  const handleSendAll = async () => {
    setShowConfirmDialog(false)
    setSending(true)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/weekly-digest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ testMode: false }),
      })

      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        setSendResult(data.results)
        setShowResultDialog(true)
        loadStats() // Refresh stats
      } else {
        toast.error(data.error || 'Failed to send weekly digest')
      }
    } catch (error) {
      console.error('Failed to send weekly digest:', error)
      toast.error('Failed to send weekly digest')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64 mt-1" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mail className="h-6 w-6" />
              Weekly Digest
            </h1>
            <p className="text-muted-foreground">
              Send weekly summary emails to family members
            </p>
          </div>
        </div>
        <Button onClick={() => loadStats(true)} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Eligible Users
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.eligibleUsers || 0}</div>
            <p className="text-xs text-muted-foreground">Parents & Guardians</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Week Preview
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.preview.upcomingEventsCount || 0}</div>
            <p className="text-xs text-muted-foreground">Events this week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last Sent
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {stats?.lastSent 
                ? new Date(stats.lastSent).toLocaleDateString()
                : 'Never'
              }
            </div>
            {stats?.lastSentBy && (
              <p className="text-xs text-muted-foreground">by {stats.lastSentBy}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Week Range
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {stats?.preview.weekStart 
                ? new Date(stats.preview.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '-'
              }
              {' - '}
              {stats?.preview.weekEnd
                ? new Date(stats.preview.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '-'
              }
            </div>
            <p className="text-xs text-muted-foreground">Current digest period</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Send Weekly Digest</CardTitle>
          <CardDescription>
            Send a summary email to all eligible users or test with a specific email
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="testEmail">Test Email (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="testEmail"
                  type="email"
                  placeholder="user@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                />
                <Button 
                  variant="outline" 
                  onClick={handleSendTest}
                  disabled={sending || !testEmail}
                >
                  {sending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <TestTube className="h-4 w-4" />
                  )}
                  <span className="ml-2 hidden sm:inline">Test</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Send a test digest to verify the email content before sending to all users
              </p>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Send to All Users</h4>
              <p className="text-sm text-muted-foreground">
                This will send the weekly digest to {stats?.eligibleUsers || 0} users
              </p>
            </div>
            <Button 
              onClick={() => setShowConfirmDialog(true)}
              disabled={sending || !stats?.eligibleUsers}
            >
              {sending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send to All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Eligible Users Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Eligible Recipients
              </CardTitle>
              <CardDescription className="mt-1.5">
                Users who will receive the weekly digest (Parents and Guardians only with digest enabled)
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <div className="text-right text-sm">
                  <p className="text-muted-foreground">Last updated</p>
                  <p className="font-medium">
                    {lastUpdated.toLocaleTimeString('en-US', { 
                      hour: 'numeric', 
                      minute: '2-digit',
                      hour12: true 
                    })}
                  </p>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>
          {nextRefresh && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <Clock className="h-3.5 w-3.5" />
              <span>Auto-refreshes 3 times daily (every 8 hours). Next refresh: {nextRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Name</TableHead>
                  <TableHead className="font-semibold">Email</TableHead>
                  <TableHead className="font-semibold">Phone</TableHead>
                  <TableHead className="font-semibold">Family</TableHead>
                  <TableHead className="font-semibold">Role</TableHead>
                  <TableHead className="font-semibold">Last Active</TableHead>
                  <TableHead className="font-semibold">Digest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats?.users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-8 w-8 text-muted-foreground/50" />
                        <p>No eligible users found</p>
                        <p className="text-xs">Users must be Parents or Guardians with weekly digest enabled</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  stats?.users.slice(0, 50).map((user) => (
                    <TableRow key={user.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">
                        {user.first_name} {user.last_name}
                      </TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.phone || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.family_name}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={user.role === 'PARENT' ? 'default' : 'secondary'}
                          className="capitalize"
                        >
                          {user.role.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.last_login_at 
                          ? new Date(user.last_login_at).toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : 'Never'
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Enabled
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {stats && stats.users.length > 50 && (
            <p className="text-sm text-muted-foreground text-center mt-4">
              Showing 50 of {stats.users.length} users
            </p>
          )}
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Send Weekly Digest</DialogTitle>
            <DialogDescription>
              Are you sure you want to send the weekly digest to {stats?.eligibleUsers || 0} users?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">
                Make sure you have tested the digest before sending to all users.
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendAll}>
              <Send className="h-4 w-4 mr-2" />
              Confirm Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result Dialog */}
      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Digest Send Results</DialogTitle>
            <DialogDescription>
              Summary of the weekly digest send operation
            </DialogDescription>
          </DialogHeader>
          {sendResult && (
            <div className="py-4 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted">
                  <div className="text-2xl font-bold">{sendResult.total}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-green-100 dark:bg-green-900/20">
                  <div className="text-2xl font-bold text-green-600">{sendResult.sent}</div>
                  <div className="text-xs text-muted-foreground">Sent</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-red-100 dark:bg-red-900/20">
                  <div className="text-2xl font-bold text-red-600">{sendResult.failed}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>

              {sendResult.details.length > 0 && (
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Events</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sendResult.details.map((detail, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-sm">{detail.email}</TableCell>
                          <TableCell>
                            {detail.status === 'sent' ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-red-600" />
                            )}
                          </TableCell>
                          <TableCell>{detail.events}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowResultDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
