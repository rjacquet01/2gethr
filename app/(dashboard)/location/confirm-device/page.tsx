'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { authFetch } from '@/hooks/use-auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { AlertTriangle, MapPin } from 'lucide-react'

// The Android app (1.2.6+) opens this page after the location permissions, with
// a one-time code in the URL fragment (kept out of server logs). Signed in on
// this phone, we confirm the token belongs to this account; then the app may
// start sharing. A token from another account is refused and revoked.
const BACK_TO_APP = 'intent://confirmed#Intent;scheme=togethr-bg;package=com.togethrapp.mobile;end'

type State =
  | { kind: 'checking' }
  | { kind: 'ok'; name: string; familyName: string }
  | { kind: 'error'; message: string }

export default function ConfirmDevicePage() {
  const [state, setState] = useState<State>({ kind: 'checking' })
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    const code = new URLSearchParams(window.location.hash.slice(1)).get('c') || ''
    // Drop the code from the address bar and history.
    window.history.replaceState(null, '', window.location.pathname)
    authFetch('/api/location/device-token/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.success) setState({ kind: 'ok', name: data.name, familyName: data.familyName })
        else setState({ kind: 'error', message: data.error || 'Background sharing could not be turned on.' })
      })
      .catch(() => setState({ kind: 'error', message: 'Background sharing could not be turned on. Check your connection and try again.' }))
  }, [])

  return (
    <div className="mx-auto max-w-md py-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {state.kind === 'error' ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <MapPin className="h-5 w-5 text-primary" />}
            Background sharing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {state.kind === 'checking' && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner className="h-4 w-4" /> Checking this phone&apos;s setup…
            </p>
          )}
          {state.kind === 'ok' && (
            <>
              <p>
                This phone will share <span className="font-medium">{state.name}</span>&apos;s location with{' '}
                <span className="font-medium">{state.familyName}</span>, even when Togethr is closed.
              </p>
              <Button className="w-full" onClick={() => { window.location.href = BACK_TO_APP }}>
                Start sharing
              </Button>
            </>
          )}
          {state.kind === 'error' && (
            <>
              <p>{state.message}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/location">Back to Location</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
