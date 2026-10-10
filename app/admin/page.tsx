'use client'

import { useEffect, useState } from 'react'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import Link from 'next/link'
import {
  Users, Home, CreditCard, TicketIcon, AlertTriangle,
  TrendingUp, Clock, ArrowRight, ArrowUpCircle
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface DashboardStats {
  users: { total: number; active: number; newThisWeek: number; newThisMonth: number }
  families: { total: number; newThisWeek: number }
  subscriptions: { 
    total: number; active: number; trialing: number; pastDue: number; cancelled: number
    byTier: Record<string, number>
  }
  tickets: { 
    total: number; open: number; inProgress: number; waitingUser: number
    escalated: number; urgent: number; newToday: number
  }
  riskFlags: { open: number; investigating: number; critical: number }
  closedAccounts: { total: number; last7d: number; last30d: number; avgTenureDays: number; withinFirstWeek: number }
  recentActivity: Array<{
    action: string
    targetType: string
    adminEmail: string
    adminName: string
    createdAt: string
  }>
}

function StatCard({ 
  title, value, subtitle, icon: Icon, href, variant = 'default' 
}: { 
  title: string
  value: number | string
  subtitle?: string
  icon: React.ElementType
  href?: string
  variant?: 'default' | 'warning' | 'danger'
}) {
  const content = (
    <Card className={variant === 'danger' ? 'border-destructive/50' : variant === 'warning' ? 'border-warning/50' : ''}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${
          variant === 'danger' ? 'text-destructive' : 
          variant === 'warning' ? 'text-warning' : 
          'text-muted-foreground'
        }`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }
  return content
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadStats() {
      try {
        const token = getAdminAccessToken()
        const res = await fetch('/api/admin/dashboard', { 
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch (error) {
        console.error('Failed to load dashboard stats:', error)
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of Togethr platform</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Failed to load dashboard</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of Togethr platform</p>
      </div>

      {/* Alerts */}
      {(stats.tickets.urgent > 0 || stats.riskFlags.critical > 0) && (
        <div className="flex flex-wrap gap-3">
          {stats.tickets.urgent > 0 && (
            <Link href="/admin/tickets?priority=URGENT">
              <Badge variant="destructive" className="px-3 py-1.5 text-sm cursor-pointer">
                <AlertTriangle className="h-4 w-4 mr-2" />
                {stats.tickets.urgent} Urgent Ticket{stats.tickets.urgent !== 1 ? 's' : ''}
              </Badge>
            </Link>
          )}
          {stats.riskFlags.critical > 0 && (
            <Link href="/admin/risk-flags?severity=CRITICAL">
              <Badge variant="destructive" className="px-3 py-1.5 text-sm cursor-pointer">
                <AlertTriangle className="h-4 w-4 mr-2" />
                {stats.riskFlags.critical} Critical Risk Flag{stats.riskFlags.critical !== 1 ? 's' : ''}
              </Badge>
            </Link>
          )}
        </div>
      )}

      {/* Main stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={stats.users.total.toLocaleString()}
          subtitle={`${stats.users.newThisWeek} new this week`}
          icon={Users}
          href="/admin/users"
        />
        <StatCard
          title="Families"
          value={stats.families.total.toLocaleString()}
          subtitle={`${stats.families.newThisWeek} new this week`}
          icon={Home}
          href="/admin/families"
        />
        <StatCard
          title="Active Subscriptions"
          value={stats.subscriptions.active.toLocaleString()}
          subtitle={`${stats.subscriptions.trialing} trialing`}
          icon={CreditCard}
          href="/admin/subscriptions"
        />
        <StatCard
          title="Open Tickets"
          value={stats.tickets.open + stats.tickets.inProgress}
          subtitle={`${stats.tickets.newToday} new today`}
          icon={TicketIcon}
          href="/admin/tickets"
          variant={stats.tickets.open > 20 ? 'warning' : 'default'}
        />
      </div>

      {/* Quick links */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/admin/upgrades">
          <Card className="hover:bg-muted/50 transition-colors">
            <CardContent className="flex items-center gap-3 py-4">
              <ArrowUpCircle className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Upgrade Requests</p>
                <p className="text-xs text-muted-foreground">Review pending subscription upgrade requests</p>
              </div>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Premium Plus</span>
              <Badge variant="secondary">{stats.subscriptions.byTier?.PREMIUM_PLUS || 0}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Premium</span>
              <Badge variant="secondary">{stats.subscriptions.byTier?.PREMIUM || 0}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Free</span>
              <Badge variant="secondary">{stats.subscriptions.byTier?.FREE || 0}</Badge>
            </div>
            {stats.subscriptions.pastDue > 0 && (
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm text-destructive">Past Due</span>
                <Badge variant="destructive">{stats.subscriptions.pastDue}</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ticket Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Open</span>
              <Badge variant="secondary">{stats.tickets.open}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">In Progress</span>
              <Badge variant="secondary">{stats.tickets.inProgress}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Waiting on User</span>
              <Badge variant="secondary">{stats.tickets.waitingUser}</Badge>
            </div>
            {stats.tickets.escalated > 0 && (
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm text-warning">Escalated</span>
                <Badge className="bg-warning text-warning-foreground">{stats.tickets.escalated}</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk Flags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Open</span>
              <Badge variant="secondary">{stats.riskFlags.open}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Investigating</span>
              <Badge variant="secondary">{stats.riskFlags.investigating}</Badge>
            </div>
            {stats.riskFlags.critical > 0 && (
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm text-destructive">Critical</span>
                <Badge variant="destructive">{stats.riskFlags.critical}</Badge>
              </div>
            )}
            <Link href="/admin/risk-flags">
              <Button variant="outline" size="sm" className="w-full mt-2">
                View All <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Closed accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Closed Accounts</CardTitle>
          <CardDescription>Users who deleted their account</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div><div className="text-2xl font-bold">{stats.closedAccounts?.total ?? 0}</div><p className="text-xs text-muted-foreground">Total closed</p></div>
            <div><div className="text-2xl font-bold">{stats.closedAccounts?.last7d ?? 0}</div><p className="text-xs text-muted-foreground">Last 7 days</p></div>
            <div><div className="text-2xl font-bold">{stats.closedAccounts?.last30d ?? 0}</div><p className="text-xs text-muted-foreground">Last 30 days</p></div>
            <div><div className="text-2xl font-bold">{stats.closedAccounts?.avgTenureDays ?? 0}d</div><p className="text-xs text-muted-foreground">Avg. account age</p></div>
            <div><div className="text-2xl font-bold">{stats.closedAccounts?.withinFirstWeek ?? 0}</div><p className="text-xs text-muted-foreground">Closed in first week</p></div>
          </div>
          {stats.users.total + (stats.closedAccounts?.total ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Churn rate: {(((stats.closedAccounts?.total ?? 0) / ((stats.users.total + (stats.closedAccounts?.total ?? 0)) || 1)) * 100).toFixed(1)}% of all signups
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Admin Activity</CardTitle>
          <CardDescription>Latest actions by admin team</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {stats.recentActivity.map((activity, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{activity.adminName}</span>
                    <span className="text-muted-foreground"> {activity.action.toLowerCase().replace(/_/g, ' ')}</span>
                    {activity.targetType && (
                      <span className="text-muted-foreground"> on {activity.targetType}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(activity.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
