'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { CalendarDays, ListChecks, Loader2, MessagesSquare } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { authFetch } from '@/hooks/use-auth'
import { useMyRole } from '@/hooks/use-my-role'
import type { ActivityItem } from '@/lib/activity-feed'

// Activity: who added or changed what in the family, newest first. Read only.

interface Feed { items: ActivityItem[]; days: number }

const fetcher = async (url: string): Promise<Feed | null> => {
  const res = await authFetch(url)
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  return (json?.data as Feed) ?? null
}

const ICON = { event: CalendarDays, task: ListChecks, post: MessagesSquare } as const

/** "5 min ago", "Yesterday 3:05 PM", "Nov 3, 3:05 PM". */
function when(iso: string): string {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  if (d >= startOfToday) return `Today ${time}`
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
  if (d >= startOfYesterday) return `Yesterday ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

export default function ActivityPage() {
  const { familyId, isGuest } = useMyRole()
  const [limit, setLimit] = useState(40)
  const { data, isLoading } = useSWR(
    familyId && !isGuest ? `/api/activity?familyId=${familyId}&limit=${limit}` : null,
    fetcher,
    { revalidateOnFocus: true, keepPreviousData: true }
  )

  if (isGuest) {
    return <div className="container max-w-2xl py-6"><Empty title="Not available" description="Activity is for family members." /></div>
  }

  return (
    <div className="container max-w-2xl py-6">
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Who added or changed things in your family{data ? `, the last ${data.days} days` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && !data ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !data ? (
            <Empty title="Activity isn't available" description="Try again in a minute." />
          ) : data.items.length === 0 ? (
            <Empty title="Nothing yet" description="New events, tasks and Board posts will show up here." />
          ) : (
            <>
              <ul className="divide-y">
                {data.items.map((item) => {
                  const Icon = ICON[item.kind]
                  return (
                    <li key={item.id}>
                      <Link href={item.href} className="flex items-start gap-3 py-3 hover:bg-muted/40 -mx-2 px-2 rounded-md">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">
                            {item.actor && <span className="font-medium">{item.actor} </span>}
                            {item.verb && <span>{item.verb} </span>}
                            {item.subject && <span className="font-medium break-words">{item.subject}</span>}
                            {item.tail && <span>{item.tail}</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">{when(item.at)}</span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {data.items.length >= limit && limit < 100 && (
                <div className="pt-4 text-center">
                  <Button variant="outline" onClick={() => setLimit(100)}>Show more</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
