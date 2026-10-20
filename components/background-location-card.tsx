'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { authFetch } from '@/hooks/use-auth'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { AlertTriangle, MapPin } from 'lucide-react'

// Google Play "prominent disclosure": shown in the app, before the Android
// location permission prompt, naming the data and every background use.
export const BACKGROUND_LOCATION_DISCLOSURE =
  'Togethr collects location data to share your live location with your family and to send arrival and departure alerts for saved places, even when the app is closed or not in use.'

// The background service reaches the server at least every 2 min (5 min
// while paused; 45 s on app 1.2.4 and older); this long without an update
// means Android stopped it (battery saver, force stop, app update...).
const STOPPED_AFTER_MIN = 15

// Phone battery savers are the usual reason sharing stops in the background.
function batterySteps(): string[] {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/SamsungBrowser|SM-[A-Z0-9]/i.test(ua)) {
    return [
      'Settings > Apps > Togethr > Battery > Unrestricted',
      'Settings > Battery > Background usage limits: remove Togethr from "Sleeping apps" and "Deep sleeping apps"',
    ]
  }
  return [`Settings > Apps > Togethr > Battery > Unrestricted (or "Don't optimize")`]
}

interface Props {
  memberId?: string
  familyId?: string
  intervalSec: number
}

// Only rendered inside the Android app. The native app registers the
// togethr-bg:// link; opening it hands it a scoped token and starts the
// background location service.
export function BackgroundLocationCard({ memberId, familyId, intervalSec }: Props) {
  const { isAndroidApp } = usePurchaseUi()
  const [status, setStatus] = useState<{ active: boolean; lastSeenAt: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  // Opened from the "Location sharing stopped - tap to resume" notification.
  const [fromResumeLink, setFromResumeLink] = useState(false)
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('resume') === '1') setFromResumeLink(true)
    } catch {}
  }, [])
  useEffect(() => {
    if (fromResumeLink && isAndroidApp) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [fromResumeLink, isAndroidApp])

  const load = useCallback(async () => {
    if (!memberId || !familyId) return
    try {
      const res = await authFetch(`/api/location/device-token?memberId=${memberId}&familyId=${familyId}`)
      if (res.ok) setStatus(await res.json())
    } catch {
      // ignore
    }
  }, [memberId, familyId])

  useEffect(() => {
    if (!isAndroidApp) return
    load()
    // Only refresh the status while the screen is visible.
    const t = setInterval(() => {
      if (!document.hidden) load()
    }, 30000)
    return () => clearInterval(t)
  }, [isAndroidApp, load])

  if (!isAndroidApp || !memberId || !familyId) return null

  const enable = async () => {
    setBusy(true)
    try {
      const res = await authFetch('/api/location/device-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, familyId }),
      })
      const data = await res.json()
      if (!res.ok || !data.token) {
        toast.error(data.error || 'Could not turn on background sharing')
        return
      }
      const q = new URLSearchParams({
        token: data.token,
        member: memberId,
        family: familyId,
        host: window.location.origin,
        interval: String(intervalSec || 300),
      })
      // Explicitly targets our own app so no other app can receive the token.
      window.location.href = `intent://configure?${q.toString()}#Intent;scheme=togethr-bg;package=com.togethrapp.mobile;end`
      setTimeout(load, 4000)
    } catch {
      toast.error('Could not turn on background sharing')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await authFetch(`/api/location/device-token?memberId=${memberId}&familyId=${familyId}`, { method: 'DELETE' })
      toast.success('Background sharing turned off')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const last = status?.lastSeenAt ? new Date(status.lastSeenAt) : null
  const minsAgo = last ? Math.max(0, Math.round((Date.now() - last.getTime()) / 60000)) : null
  // On, but the phone has gone quiet: the background service was stopped.
  const stopped = !!status?.active && minsAgo !== null && minsAgo >= STOPPED_AFTER_MIN

  return (
    <Card ref={cardRef} className={fromResumeLink ? 'ring-2 ring-primary' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Background location
          {status?.active && <Badge variant="secondary">On</Badge>}
        </CardTitle>
        <CardDescription>Keep sharing when the app is closed so arrival and departure alerts are never missed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{BACKGROUND_LOCATION_DISCLOSURE}</p>
        {status?.active && !stopped && (
          <p className="text-xs text-muted-foreground">
            {minsAgo === null ? 'Waiting for the first update…' : minsAgo === 0 ? 'Last update just now' : `Last update ${minsAgo} min ago`}
          </p>
        )}
        {stopped && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30 space-y-2">
            <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              Background sharing stopped on this phone
            </p>
            <p className="text-amber-900/80 dark:text-amber-200/80">
              The last update was {minsAgo! >= 120 ? `about ${Math.round(minsAgo! / 60)} hours` : `${minsAgo} minutes`} ago, so your family
              can&apos;t see where you are. Tap Restart below. To keep it from stopping again, set the battery to Unrestricted:
            </p>
            <ul className="list-disc pl-5 text-amber-900/80 dark:text-amber-200/80">
              {batterySteps().map((step) => <li key={step}>{step}</li>)}
            </ul>
          </div>
        )}
        {stopped ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={enable} disabled={busy}>Restart background sharing</Button>
            <Button variant="outline" onClick={disable} disabled={busy}>Turn off</Button>
          </div>
        ) : status?.active ? (
          <Button variant="outline" onClick={disable} disabled={busy}>Turn off background sharing</Button>
        ) : (
          <Button onClick={enable} disabled={busy}>Turn on background sharing</Button>
        )}
        <p className="text-xs text-muted-foreground">
          You can turn this off at any time here or from the notification. If nothing happens, update the Togethr app from Google Play.
        </p>
      </CardContent>
    </Card>
  )
}
