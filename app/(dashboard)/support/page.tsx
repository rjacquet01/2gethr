'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  Plus, 
  MessageSquare, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  ArrowRight,
  HelpCircle,
  Inbox
} from 'lucide-react'
import { authFetch } from '@/hooks/use-events'

interface Ticket {
  id: string
  ticket_number: string
  subject: string
  category: string
  priority: string
  status: string
  created_at: string
  updated_at: string
  message_count: number
  unread_replies: number
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)

  const loadTickets = useCallback(async () => {
    try {
      const res = await authFetch('/api/support')
      
      if (res.ok) {
        const data = await res.json()
        setTickets(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load tickets:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTickets()
  }, [loadTickets])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return <Badge variant="default" className="bg-blue-500">Open</Badge>
      case 'IN_PROGRESS':
        return <Badge variant="default" className="bg-yellow-500">In Progress</Badge>
      case 'WAITING_ON_CUSTOMER':
        return <Badge variant="default" className="bg-orange-500">Awaiting Reply</Badge>
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

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'BILLING':
        return '💳'
      case 'TECHNICAL':
        return '🔧'
      case 'ACCOUNT':
        return '👤'
      case 'FEATURE_REQUEST':
        return '💡'
      default:
        return '📋'
    }
  }

  const openTickets = tickets.filter(t => !['RESOLVED', 'CLOSED'].includes(t.status))
  const closedTickets = tickets.filter(t => ['RESOLVED', 'CLOSED'].includes(t.status))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Support</h1>
          <p className="text-muted-foreground">Get help with your account</p>
        </div>
        <Button asChild>
          <Link href="/support/new">
            <Plus className="w-4 h-4 mr-2" />
            New Ticket
          </Link>
        </Button>
      </div>

      {/* Quick Help Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/support/faqs">
          <Card className="border-dashed hover:border-blue-500/50 hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/20">
                <HelpCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="font-medium text-sm">FAQs</p>
                <p className="text-xs text-muted-foreground">Common questions</p>
              </div>
              <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/20">
              <MessageSquare className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="font-medium text-sm">Live Chat</p>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
          </CardContent>
        </Card>
        <a href="mailto:admin@mytogethr.com" target="_blank" rel="noopener noreferrer">
          <Card className="border-dashed hover:border-purple-500/50 hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/20">
                <Inbox className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="font-medium text-sm">Email Us</p>
                <p className="text-xs text-muted-foreground">admin@mytogethr.com</p>
              </div>
              <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </a>
      </div>

      {/* Open Tickets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Open Tickets ({openTickets.length})
          </CardTitle>
          <CardDescription>Tickets awaiting response or resolution</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : openTickets.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-3" />
              <p className="text-muted-foreground">No open tickets</p>
              <p className="text-sm text-muted-foreground">You're all caught up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {openTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/support/${ticket.id}`}
                  className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <span className="text-2xl">{getCategoryIcon(ticket.category)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate">{ticket.subject}</span>
                      {ticket.unread_replies > 0 && (
                        <Badge variant="default" className="bg-red-500">
                          {ticket.unread_replies} new
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{ticket.ticket_number}</span>
                      <span>|</span>
                      <Clock className="w-3 h-3" />
                      <span>{format(parseISO(ticket.updated_at), 'MMM d, h:mm a')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {getStatusBadge(ticket.status)}
                    {getPriorityBadge(ticket.priority)}
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Closed Tickets */}
      {closedTickets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Resolved Tickets ({closedTickets.length})
            </CardTitle>
            <CardDescription>Previously resolved support requests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {closedTickets.slice(0, 5).map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/support/${ticket.id}`}
                  className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors opacity-75"
                >
                  <span className="text-2xl">{getCategoryIcon(ticket.category)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{ticket.subject}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{ticket.ticket_number}</span>
                      <span>|</span>
                      <span>Closed {format(parseISO(ticket.updated_at), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {getStatusBadge(ticket.status)}
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
