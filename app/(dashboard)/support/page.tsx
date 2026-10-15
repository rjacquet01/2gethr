'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  Plus,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Mail,
  CreditCard,
  Wrench,
  User,
  Lightbulb,
  LifeBuoy,
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

const STATUS: Record<string, { label: string; dot: string }> = {
  OPEN: { label: 'Open', dot: 'bg-blue-500' },
  IN_PROGRESS: { label: 'In progress', dot: 'bg-yellow-500' },
  WAITING_ON_CUSTOMER: { label: 'Awaiting your reply', dot: 'bg-orange-500' },
  RESOLVED: { label: 'Resolved', dot: 'bg-green-500' },
  CLOSED: { label: 'Closed', dot: 'bg-muted-foreground' },
}

const PRIORITY: Record<string, string> = {
  URGENT: 'text-destructive',
  HIGH: 'text-orange-600',
}

function CategoryIcon({ category }: { category: string }) {
  const cls = 'h-4 w-4'
  switch (category) {
    case 'BILLING':
      return <CreditCard className={cls} />
    case 'TECHNICAL':
      return <Wrench className={cls} />
    case 'ACCOUNT':
      return <User className={cls} />
    case 'FEATURE_REQUEST':
      return <Lightbulb className={cls} />
    default:
      return <LifeBuoy className={cls} />
  }
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'open' | 'resolved'>('open')

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

  const openTickets = tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status))
  const closedTickets = tickets.filter((t) => ['RESOLVED', 'CLOSED'].includes(t.status))
  const unread = openTickets.reduce((n, t) => n + (t.unread_replies || 0), 0)
  const shown = tab === 'open' ? openTickets : closedTickets

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Support</h1>
          <p className="text-sm text-muted-foreground">
            {openTickets.length} open{unread > 0 && <> · {unread} new {unread === 1 ? 'reply' : 'replies'}</>}
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/support/new">
            <Plus className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">New ticket</span>
            <span className="sm:hidden">New</span>
          </Link>
        </Button>
      </div>

      {/* Quick help */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href="/support/faqs"
          className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
            <HelpCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Browse FAQs</p>
            <p className="text-xs text-muted-foreground">Quick answers to common questions</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <a
          href="mailto:admin@mytogethr.com"
          className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
            <Mail className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Email us</p>
            <p className="truncate text-xs text-muted-foreground">admin@mytogethr.com</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </a>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-lg bg-muted p-1">
        {(
          [
            ['open', 'Open', openTickets.length],
            ['resolved', 'Resolved', closedTickets.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label} <span className="text-muted-foreground">{count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
          <p className="mt-2 font-medium">{tab === 'open' ? 'No open tickets' : 'Nothing resolved yet'}</p>
          <p className="text-sm text-muted-foreground">
            {tab === 'open' ? "You're all caught up." : 'Resolved tickets will show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {(tab === 'resolved' ? shown.slice(0, 20) : shown).map((t) => {
            const st = STATUS[t.status] || { label: t.status, dot: 'bg-muted-foreground' }
            return (
              <Link
                key={t.id}
                href={`/support/${t.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50',
                  tab === 'resolved' && 'opacity-80'
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <CategoryIcon category={t.category} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{t.subject}</span>
                    {t.unread_replies > 0 && (
                      <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {t.unread_replies} new
                      </span>
                    )}
                  </div>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span className={cn('h-2 w-2 rounded-full', st.dot)} />
                    <span>{st.label}</span>
                    <span>·</span>
                    <span>{t.ticket_number}</span>
                    <span>·</span>
                    <span>{format(parseISO(t.updated_at), 'MMM d, h:mm a')}</span>
                    {PRIORITY[t.priority] && (
                      <span className={cn('font-medium', PRIORITY[t.priority])}>· {t.priority.toLowerCase()}</span>
                    )}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
