'use client'

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/hooks/use-auth'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { MapPin } from 'lucide-react'

// Google Play "prominent disclosure": shown in the app, before the Android
// location permission prompt, naming the data and every background use.
export const BACKGROUND_LOCATION_DISCLOSURE =
  'Togethr collects location data to share your live location with your family and to send arrival and departure alerts for saved places, even when the app is closed or not in use.'

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
    const t = setInterval(load, 30000)
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

  return (
    <Card>
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
        {status?.active && (
          <p className="text-xs text-muted-foreground">
            {minsAgo === null ? 'Waiting for the first update…' : minsAgo === 0 ? 'Last update just now' : `Last update ${minsAgo} min ago`}
          </p>
        )}
        {status?.active ? (
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
