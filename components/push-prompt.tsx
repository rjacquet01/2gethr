'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Bell, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { authFetch } from '@/hooks/use-auth'
import { isIos } from '@/lib/ios-setup'
import { pushPromptSnoozed, pushTurnedOffHere, setPushOffHere, snoozePushPrompt } from '@/lib/push-prefs'

// Most accounts never had push turned on: the only ways in were a toggle
// buried in Settings and a dismissible checklist card. This asks once, right
// on the dashboard, with a button that asks the browser for permission
// (a tap is what lets it show the permission dialog), and it repairs a
// device that already allowed notifications but has no working subscription.
//
// iPhones have their own steps (components/iphone-setup.tsx), so this stays
// out of their way.

async function markPushOnForAccount() {
  await authFetch('/api/user/notification-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushNotifications: true }),
  }).catch(() => null)
}

const noSubscribe = () => () => {}

export function PushPrompt() {
  const push = usePushNotifications()
  // Browser-only checks (iPhone, snoozed). Hidden while rendering on the server.
  const hiddenHere = useSyncExternalStore(
    noSubscribe,
    () => isIos(navigator.userAgent, navigator.maxTouchPoints) || pushPromptSnoozed(),
    () => true,
  )
  const [closed, setClosed] = useState(false)
  const [busy, setBusy] = useState(false)
  const repaired = useRef(false)
  const hidden = hiddenHere || closed

  // Permission already granted but no active subscription for this account
  // (a cleared site, an old subscription the push service dropped, another
  // account's subscription on this browser): subscribe again, no dialog.
  // Not if the person switched push off on this device themselves.
  useEffect(() => {
    if (hidden || repaired.current) return
    if (push.isLoading || !push.isSupported || push.isSubscribed) return
    if (push.permission !== 'granted' || pushTurnedOffHere()) return
    repaired.current = true
    push.subscribe().then((ok) => {
      if (ok) void markPushOnForAccount()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, push.isLoading, push.isSupported, push.isSubscribed, push.permission])

  // Ask only while the browser would still show its permission dialog.
  if (hidden) return null
  if (push.isLoading || !push.isSupported || push.isSubscribed || push.permission !== 'default') return null

  const turnOn = async () => {
    setBusy(true)
    const ok = await push.subscribe()
    setBusy(false)
    if (!ok) {
      toast.error('Notifications are off. Allow them for Togethr in your browser or phone settings, then try again from Settings.')
      return
    }
    setPushOffHere(false)
    await markPushOnForAccount()
    toast.success('Notifications on')
    setClosed(true)
  }

  const later = () => {
    snoozePushPrompt()
    setClosed(true)
  }

  return (
    <Card className="mb-4 border-primary/40 bg-primary/5 py-0">
      <CardContent className="flex items-start gap-3 p-4">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 space-y-2 text-sm">
          <p className="font-medium">Turn on notifications</p>
          <p className="text-muted-foreground">
            Get reminders, event and task updates and family alerts on this device. You can switch it off any time in Settings.
          </p>
          <Button size="sm" onClick={turnOn} disabled={busy}>Turn on</Button>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Not now" onClick={later}>
          <X className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}
