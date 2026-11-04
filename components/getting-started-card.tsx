'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Bell, Check, MapPin, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { authFetch } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

// A new family's first steps on the dashboard: invite the family, turn on
// notifications on this device, share location. Gone once all three are
// done, or for good (on this device) when closed.
const dismissKey = (familyId: string) => `togethr-getting-started-closed:${familyId}`

const noSubscribe = () => () => {}

function readDismissed(familyId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(familyId)) === '1'
  } catch {
    return false
  }
}

const sharingFetcher = async (url: string) => {
  const res = await authFetch(url)
  if (!res.ok) return []
  const json = await res.json()
  return (Array.isArray(json.data) ? json.data : []) as Array<{ familyId: string; mode?: string; shareWithFamily?: boolean }>
}

function Item({ done, icon: Icon, title, href, action }: { done: boolean; icon: typeof Bell; title: string; href: string; action: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', done ? 'bg-green-600 text-white' : 'bg-primary/10 text-primary')}>
        {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className={cn('flex-1 text-sm', done && 'text-muted-foreground line-through')}>{title}</span>
      {!done && (
        <Button size="sm" variant="outline" asChild>
          <Link href={href}>{action}</Link>
        </Button>
      )}
    </li>
  )
}

export function GettingStartedCard({ familyId, hasOthers }: { familyId: string; hasOthers: boolean }) {
  const storedDismissed = useSyncExternalStore(noSubscribe, () => readDismissed(familyId), () => true)
  const [closed, setClosed] = useState(false)
  const push = usePushNotifications()
  const { data: sharing } = useSWR('/api/location/settings', sharingFetcher)

  const mine = sharing?.find((s) => s.familyId === familyId)
  const sharingOn = !!mine && mine.mode !== undefined && mine.mode !== 'OFF' && mine.shareWithFamily === true
  // Unknown until checked: count as done so the card doesn't flash.
  const pushDone = push.isLoading || !push.isSupported || push.isSubscribed
  const locationDone = !sharing || sharingOn

  if (storedDismissed || closed || (hasOthers && pushDone && locationDone)) return null

  const dismiss = () => {
    try { localStorage.setItem(dismissKey(familyId), '1') } catch { /* not remembered */ }
    setClosed(true)
  }

  return (
    <Card className="border-primary/40 bg-primary/5 py-0">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start gap-2">
          <div className="flex-1">
            <p className="font-semibold">Get your family set up</p>
            <p className="text-sm text-muted-foreground">Three quick steps so nobody gets left behind.</p>
          </div>
          <button type="button" onClick={dismiss} aria-label="Close" className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-2">
          <Item done={hasOthers} icon={UserPlus} title="Invite your family" href="/family" action="Invite" />
          <Item done={pushDone} icon={Bell} title="Turn on notifications on this device" href="/settings" action="Turn on" />
          <Item done={locationDone} icon={MapPin} title="Share your location with the family" href="/location" action="Share" />
        </ul>
      </CardContent>
    </Card>
  )
}
