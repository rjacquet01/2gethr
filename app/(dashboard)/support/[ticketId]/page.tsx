'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  ArrowLeft, 
  Send, 
  Clock,
  User,
  MessageSquare,
  AlertCircle,
  CheckCircle2
} from 'lucide-react'
import { toast } from 'sonner'
import { authFetch } from '@/hooks/use-events'

interface Message {
  id: string
  message: string
  sender_type: 'USER' | 'ADMIN' | 'SYSTEM'
  sender_name: string
  sender_email: string
  is_internal_note: boolean
  created_at: string
}

interface Ticket {
  id: string
  ticket_number: string
  subject: string
  description: string
  category: string
  priority: string
  status: string
  family_name: string | null
  created_at: string
  updated_at: string
  first_response_at: string | null
  resolved_at: string | null
}

export default function TicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const ticketId = params.ticketId as string
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)

  const loadTicket = useCallback(async () => {
    try {
      const res = await authFetch(`/api/support/${ticketId}`)

      if (res.ok) {
        const data = await res.json()
        setTicket(data.ticket)
        setMessages(data.messages || [])
      } else if (res.status === 404) {
        toast.error('Ticket not found')
        router.push('/support')
      }
    } catch (error) {
      console.error('Failed to load ticket:', error)
    } finally {
      setLoading(false)
    }
  }, [ticketId, router])

  useEffect(() => {
    loadTicket()
  }, [loadTicket])

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return

    setSending(true)
    try {
      const res = await authFetch(`/api/support/${ticketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage }),
      })

      if (res.ok) {
        setNewMessage('')
        await loadTicket()
        toast.success('Message sent')
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return <Badge variant="default" className="bg-blue-500">Open</Badge>
      case 'IN_PROGRESS':
        return <Badge variant="default" className="bg-yellow-500">In Progress</Badge>
      case 'WAITING_ON_CUSTOMER':
        return <Badge variant="default" className="bg-orange-500">Awaiting Your Reply</Badge>
      case 'RESOLVED':
        return <Badge variant="default" className="bg-green-500">Resolved</Badge>
      case 'CLOSED':
        return <Badge variant="secondary">Closed</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return <Badge variant="destructive">Urgent</Badge>
      case 'HIGH':
        return <Badge variant="default" className="bg-orange-500">High</Badge>
      case 'MEDIUM':
        return <Badge variant="secondary">Medium</Badge>
      case 'LOW':
        return <Badge variant="outline">Low</Badge>
      default:
        return <Badge variant="secondary">{priority}</Badge>
    }
  }

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      BILLING: 'Billing & Payments',
      TECHNICAL: 'Technical Issue',
      ACCOUNT: 'Account & Profile',
      FEATURE_REQUEST: 'Feature Request',
      GENERAL: 'General Inquiry',
      OTHER: 'General Inquiry',
    }
    return labels[category] || category
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="max-w-4xl mx-auto text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Ticket Not Found</h2>
        <p className="text-muted-foreground mb-4">This ticket doesn't exist or you don't have access to it.</p>
        <Button asChild>
          <Link href="/support">Back to Support</Link>
        </Button>
      </div>
    )
  }

  const isClosed = ticket.status === 'CLOSED'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/support">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-mono text-muted-foreground">{ticket.ticket_number}</span>
            {getStatusBadge(ticket.status)}
            {getPriorityBadge(ticket.priority)}
          </div>
          <h1 className="text-xl font-bold tracking-tight truncate">{ticket.subject}</h1>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Conversation */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Conversation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {messages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No messages yet</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex gap-3 ${
                        message.sender_type === 'USER' ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <Avatar className="w-8 h-8 shrink-0">
                        <AvatarFallback className={
                          message.sender_type === 'USER' 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-green-500 text-white'
                        }>
                          {message.sender_type === 'USER' ? 'Y' : 'S'}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`flex-1 ${message.sender_type === 'USER' ? 'text-right' : ''}`}>
                        <div className="flex items-center gap-2 mb-1">
                          {message.sender_type !== 'USER' && (
                            <span className="text-sm font-medium">{message.sender_name}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {format(parseISO(message.created_at), 'MMM d, h:mm a')}
                          </span>
                          {message.sender_type === 'USER' && (
                            <span className="text-sm font-medium">You</span>
                          )}
                        </div>
                        <div className={`inline-block p-3 rounded-lg max-w-[90%] ${
                          message.sender_type === 'USER'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply Form */}
              {!isClosed ? (
                <div className="mt-4 pt-4 border-t">
                  <Textarea
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    rows={3}
                    className="mb-3"
                  />
                  <div className="flex justify-end">
                    <Button 
                      onClick={handleSendMessage} 
                      disabled={sending || !newMessage.trim()}
                    >
                      {sending ? (
                        <>
                          <Spinner className="w-4 h-4 mr-2" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Send Message
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">This ticket is closed</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Ticket Details Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ticket Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">Category</p>
                <p className="font-medium">{getCategoryLabel(ticket.category)}</p>
              </div>
              
              <div>
                <p className="text-muted-foreground mb-1">Status</p>
                {getStatusBadge(ticket.status)}
              </div>

              <div>
                <p className="text-muted-foreground mb-1">Priority</p>
                {getPriorityBadge(ticket.priority)}
              </div>

              {ticket.family_name && (
                <div>
                  <p className="text-muted-foreground mb-1">Related Family</p>
                  <p className="font-medium">{ticket.family_name}</p>
                </div>
              )}

              <div className="pt-2 border-t space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>Created {format(parseISO(ticket.created_at), 'MMM d, yyyy')}</span>
                </div>
                
                {ticket.first_response_at && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MessageSquare className="w-4 h-4" />
                    <span>First response {format(parseISO(ticket.first_response_at), 'MMM d')}</span>
                  </div>
                )}
                
                {ticket.resolved_at && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Resolved {format(parseISO(ticket.resolved_at), 'MMM d')}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {ticket.status === 'WAITING_ON_CUSTOMER' && (
            <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-orange-500 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-orange-700 dark:text-orange-400">Response Needed</p>
                    <p className="text-orange-600 dark:text-orange-500">Our team is waiting for your reply to continue helping you.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
