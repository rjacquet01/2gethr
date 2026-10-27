'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAdminAccessToken, refreshAdminTokenIfNeeded } from '@/hooks/use-admin-auth'
import { 
  ArrowLeft, 
  Send, 
  Clock, 
  User, 
  Home, 
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  XCircle,
  UserPlus
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

interface TicketMessage {
  id: string
  message: string
  senderType: 'USER' | 'ADMIN' | 'SYSTEM'
  senderEmail: string
  senderName: string
  isInternalNote: boolean
  createdAt: string
}

interface TicketDetail {
  id: string
  ticketNumber: string
  category: string
  priority: string
  status: string
  subject: string
  description: string
  user: { id: string; email: string; name: string } | null
  family: { id: string; name: string } | null
  assignedAdmin: { id: string; email: string; name: string } | null
  messages: TicketMessage[]
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  firstResponseAt: string | null
}

const priorityColors: Record<string, string> = {
  URGENT: 'bg-destructive text-destructive-foreground',
  HIGH: 'bg-orange-500 text-white',
  NORMAL: 'bg-secondary text-secondary-foreground',
  LOW: 'bg-muted text-muted-foreground',
}

const statusColors: Record<string, string> = {
  OPEN: 'bg-blue-500 text-white',
  IN_PROGRESS: 'bg-primary text-primary-foreground',
  WAITING_USER: 'bg-orange-500 text-white',
  ESCALATED: 'bg-destructive text-destructive-foreground',
  RESOLVED: 'bg-green-500 text-white',
  CLOSED: 'bg-muted text-muted-foreground',
}

export default function AdminTicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const ticketId = params.ticketId as string
  
  const [ticket, setTicket] = useState<Omit<TicketDetail, 'messages'> | null>(null)
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState('')
  const [isInternalNote, setIsInternalNote] = useState(false)
  const [sending, setSending] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)

  const loadTicket = useCallback(async () => {
    try {
      const token = (await refreshAdminTokenIfNeeded()) ?? getAdminAccessToken()
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      
      if (res.ok) {
        const data = await res.json()
        setTicket(data.ticket)
        setMessages(data.messages || [])
      } else if (res.status === 404) {
        toast.error('Ticket not found')
        router.push('/admin/tickets')
      }
    } catch (error) {
      console.error('Failed to load ticket:', error)
      toast.error('Failed to load ticket')
    } finally {
      setLoading(false)
    }
  }, [ticketId, router])

  useEffect(() => {
    loadTicket()
  }, [loadTicket])

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return
    
    setSending(true)
    try {
      const token = (await refreshAdminTokenIfNeeded()) ?? getAdminAccessToken()
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'add_message',
          message: newMessage,
          isInternalNote,
        }),
      })
      
      if (res.ok) {
        setNewMessage('')
        setIsInternalNote(false)
        loadTicket()
        toast.success(isInternalNote ? 'Internal note added' : 'Reply sent')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to send message')
      }
    } catch (error) {
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleUpdateStatus = async (newStatus: string) => {
    setUpdatingStatus(true)
    try {
      const token = (await refreshAdminTokenIfNeeded()) ?? getAdminAccessToken()
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'update_status', status: newStatus }),
      })
      
      if (res.ok) {
        loadTicket()
        toast.success('Status updated')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update status')
      }
    } catch (error) {
      toast.error('Failed to update status')
    } finally {
      setUpdatingStatus(false)
    }
  }

  const handleUpdatePriority = async (newPriority: string) => {
    try {
      const token = (await refreshAdminTokenIfNeeded()) ?? getAdminAccessToken()
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'update_priority', priority: newPriority }),
      })
      
      if (res.ok) {
        loadTicket()
        toast.success('Priority updated')
      }
    } catch (error) {
      toast.error('Failed to update priority')
    }
  }

  const handleAssignToMe = async () => {
    try {
      const token = (await refreshAdminTokenIfNeeded()) ?? getAdminAccessToken()
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'assign' }),
      })
      
      if (res.ok) {
        loadTicket()
        setAssignDialogOpen(false)
        toast.success('Ticket assigned to you')
      }
    } catch (error) {
      toast.error('Failed to assign ticket')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Skeleton className="h-96" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Ticket not found</p>
        <Button variant="link" asChild>
          <Link href="/admin/tickets">Back to tickets</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/tickets">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{ticket.ticketNumber}</h1>
            <Badge className={statusColors[ticket.status]}>
              {ticket.status.replace('_', ' ')}
            </Badge>
            <Badge className={priorityColors[ticket.priority]}>
              {ticket.priority}
            </Badge>
          </div>
          <p className="text-muted-foreground">{ticket.subject}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Original Description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Original Request</CardTitle>
              <CardDescription>
                Submitted {format(parseISO(ticket.createdAt), 'MMM d, yyyy h:mm a')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">{ticket.description}</p>
            </CardContent>
          </Card>

          {/* Messages */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Conversation ({messages.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {messages.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No messages yet
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`p-4 rounded-lg ${
                      message.isInternalNote
                        ? 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-900'
                        : message.senderType === 'USER'
                          ? 'bg-muted'
                          : 'bg-primary/10 border border-primary/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-sm">
                        {message.isInternalNote && (
                          <Badge variant="outline" className="mr-2 text-yellow-600">
                            Internal Note
                          </Badge>
                        )}
                        {message.senderName || message.senderEmail || 'System'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(message.createdAt), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                  </div>
                ))
              )}

              <Separator />

              {/* Reply Form */}
              <div className="space-y-3">
                <Textarea
                  placeholder={isInternalNote ? "Add an internal note..." : "Type your reply..."}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  rows={4}
                />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isInternalNote}
                      onChange={(e) => setIsInternalNote(e.target.checked)}
                      className="rounded border-input"
                    />
                    Internal note (not visible to user)
                  </label>
                  <Button onClick={handleSendMessage} disabled={sending || !newMessage.trim()}>
                    <Send className="h-4 w-4 mr-2" />
                    {sending ? 'Sending...' : isInternalNote ? 'Add Note' : 'Send Reply'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select 
                  value={ticket.status} 
                  onValueChange={handleUpdateStatus}
                  disabled={updatingStatus}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="WAITING_USER">Waiting on User</SelectItem>
                    <SelectItem value="ESCALATED">Escalated</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select 
                  value={ticket.priority} 
                  onValueChange={handleUpdatePriority}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="LOW">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                {ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && (
                  <Button 
                    variant="outline" 
                    className="w-full justify-start text-green-600"
                    onClick={() => handleUpdateStatus('RESOLVED')}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark Resolved
                  </Button>
                )}
                {!ticket.assignedAdmin && (
                  <Button 
                    variant="outline" 
                    className="w-full justify-start"
                    onClick={handleAssignToMe}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Assign to Me
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category</span>
                <Badge variant="outline">{ticket.category}</Badge>
              </div>
              
              <Separator />
              
              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <User className="h-4 w-4" />
                  User
                </div>
                {ticket.user ? (
                  <div>
                    <p className="font-medium">{ticket.user.name}</p>
                    <p className="text-muted-foreground">{ticket.user.email}</p>
                    <Button variant="link" size="sm" className="h-auto p-0" asChild>
                      <Link href={`/admin/users/${ticket.user.id}`}>
                        View Profile
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No user</p>
                )}
              </div>

              {ticket.family && (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Home className="h-4 w-4" />
                      Family
                    </div>
                    <p className="font-medium">{ticket.family.name}</p>
                    <Button variant="link" size="sm" className="h-auto p-0" asChild>
                      <Link href={`/admin/families/${ticket.family.id}`}>
                        View Family
                      </Link>
                    </Button>
                  </div>
                </>
              )}

              <Separator />

              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <UserPlus className="h-4 w-4" />
                  Assigned To
                </div>
                <p className="font-medium">
                  {ticket.assignedAdmin?.email || 'Unassigned'}
                </p>
              </div>

              <Separator />

              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Clock className="h-4 w-4" />
                  Timeline
                </div>
                <div className="space-y-1 text-xs">
                  <p>Created: {format(parseISO(ticket.createdAt), 'MMM d, yyyy h:mm a')}</p>
                  <p>Updated: {format(parseISO(ticket.updatedAt), 'MMM d, yyyy h:mm a')}</p>
                  {ticket.resolvedAt && (
                    <p>Resolved: {format(parseISO(ticket.resolvedAt), 'MMM d, yyyy h:mm a')}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
