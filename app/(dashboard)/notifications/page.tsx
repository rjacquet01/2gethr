'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Bell, Calendar, MapPin, Users, Check, Trash2, Loader2, RefreshCw, ListTodo, AlertCircle, AlertTriangle, Clock, ChevronRight } from 'lucide-react'
import { notificationHref } from '@/lib/notification-link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useAuth, getAccessToken, authFetch } from '@/hooks/use-auth'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  isRead: boolean
  createdAt: string
}

const notificationIcons: Record<string, React.ElementType> = {
  EVENT_REMINDER: Calendar,
  EVENT_CREATED: Calendar,
  EVENT_INVITATION: Calendar,
  EVENT_UPDATE: Calendar,
  EVENT_APPROVAL_REQUEST: Calendar,
  EVENT_APPROVED: Calendar,
  EVENT_REJECTED: AlertCircle,
  LOCATION_ALERT: MapPin,
  GEOFENCE_ALERT: MapPin,
  FAMILY_INVITE: Users,
  FAMILY_INVITATION: Users,
  TASK_ASSIGNED: ListTodo,
  TASK_COMPLETED: Check,
  TASK_OVERDUE: AlertTriangle,
  APPROVAL_REQUEST: AlertCircle,
  APPROVAL_RESPONSE: Check,
  SUBSCRIPTION_ALERT: Bell,
  SYSTEM_ALERT: Bell,
  SYSTEM: Bell,
  DEFAULT: Bell,
}

// Red styling is for what needs action now: overdue tasks, an SOS, or someone
// turning off sharing. Routine arrivals and departures (GEOFENCE_ALERT) stay calm.
const URGENT_LOCATION_SUBTYPES = ['SOS', 'SHARING_OFF']

function isUrgentNotification(n: Notification): boolean {
  if (n.type === 'TASK_OVERDUE') return true
  return n.type === 'LOCATION_ALERT' && URGENT_LOCATION_SUBTYPES.includes(String(n.data?.subType ?? ''))
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)

  const loadNotifications = async () => {
    const token = getAccessToken()
    if (!token) {
      setLoading(false)
      return
    }

    try {
      const res = await authFetch('/api/notifications')
      if (res.ok) {
        const data = await res.json()
        const notificationsList = data.data?.notifications || data.notifications || []
        setNotifications(notificationsList)
      }
    } catch (error) {
      console.error('Failed to load notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()
  }, [user])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadNotifications()
    setRefreshing(false)
    toast.success('Notifications refreshed')
  }

  const markAsRead = async (id: string) => {
    const token = getAccessToken()
    if (!token) return

    setMarking(id)
    try {
      const res = await authFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [id] }),
      })

      if (res.ok) {
        setNotifications(prev =>
          prev.map(n => (n.id === id ? { ...n, isRead: true } : n))
        )
      }
    } catch {
      toast.error('Failed to mark notification as read')
    } finally {
      setMarking(null)
    }
  }

  // Clicking a notification marks it read and opens what it's about.
  const openNotification = (n: Notification) => {
    const href = notificationHref(n.type, n.data)
    if (!n.isRead) void markAsRead(n.id)
    if (href) router.push(href)
  }

  const markAllAsRead = async () => {
    const token = getAccessToken()
    if (!token) return

    const unreadIds = notifications.filter(n => !n.isRead).map(n => n.id)
    if (unreadIds.length === 0) return

    setMarking('all')
    try {
      const res = await authFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: unreadIds }),
      })

      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
        toast.success('All notifications marked as read')
      }
    } catch {
      toast.error('Failed to mark notifications as read')
    } finally {
      setMarking(null)
    }
  }

  const unreadCount = notifications.filter(n => !n.isRead).length

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">Stay updated with your family activities</p>
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : 'You\'re all caught up!'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              onClick={markAllAsRead}
              disabled={marking === 'all'}
            >
              {marking === 'all' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Mark all as read
            </Button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No notifications yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mt-1">
              When you receive notifications about events, family updates, or location alerts, they'll appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const Icon = notificationIcons[notification.type] || notificationIcons.DEFAULT
            const isUrgent = isUrgentNotification(notification)
            const isOverdue = notification.type === 'TASK_OVERDUE'
            const href = notificationHref(notification.type, notification.data)

            return (
              <Card
                key={notification.id}
                {...(href
                  ? {
                      role: 'link',
                      tabIndex: 0,
                      'aria-label': `${notification.title}: open`,
                      onClick: () => openNotification(notification),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotification(notification) }
                      },
                    }
                  : {})}
                className={`
                  ${notification.isRead ? 'opacity-60' : ''}
                  ${isUrgent && !notification.isRead ? 'border-red-500 border-2 bg-red-50 dark:bg-red-950/20' : ''}
                  ${href ? 'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' : ''}
                `}
              >
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    <div className={`
                      h-10 w-10 rounded-full flex items-center justify-center shrink-0
                      ${notification.isRead 
                        ? 'bg-muted' 
                        : isUrgent 
                          ? 'bg-red-100 dark:bg-red-900/50' 
                          : 'bg-primary/10'}
                    `}>
                      <Icon className={`h-5 w-5 ${
                        notification.isRead 
                          ? 'text-muted-foreground' 
                          : isUrgent 
                            ? 'text-red-600 dark:text-red-400' 
                            : 'text-primary'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className={`font-medium leading-tight ${isUrgent && !notification.isRead ? 'text-red-700 dark:text-red-400' : ''}`}>
                              {notification.title}
                            </h4>
                            {isOverdue && !notification.isRead && (
                              <Badge variant="destructive" className="shrink-0 text-xs">
                                Overdue
                              </Badge>
                            )}
                          </div>
                          {notification.body && notification.body.trim() !== notification.title.trim() && (
                            <p className={`text-sm mt-0.5 ${isUrgent && !notification.isRead ? 'text-red-600/80 dark:text-red-400/80' : 'text-muted-foreground'}`}>
                              {notification.body}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!notification.isRead && !isOverdue && (
                            <Badge variant="secondary" className="shrink-0">New</Badge>
                          )}
                          {href && <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className={`text-xs ${isUrgent && !notification.isRead ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </span>
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); markAsRead(notification.id) }}
                            onKeyDown={(e) => e.stopPropagation()}
                            disabled={marking === notification.id}
                          >
                            {marking === notification.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-3 w-3 mr-1" />
                                Mark as read
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
