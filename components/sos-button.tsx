'use client'

import { useState } from 'react'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Siren, Loader2 } from 'lucide-react'

/** One tap (plus a confirm) alerts every parent/guardian with the sender's location. */
export function SosButton({ familyId }: { familyId?: string }) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ failed: boolean; message?: string; data?: any } | null>(null)

  const send = async () => {
    setSending(true)
    setResult(null)
    try {
      // Use a fresh fix when the browser can give one quickly; the server
      // falls back to the last stored location otherwise.
      const pos = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null)
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 4000, maximumAge: 30000 })
      })
      const payload = JSON.stringify({
        familyId,
        latitude: pos?.coords.latitude,
        longitude: pos?.coords.longitude,
      })
      // An emergency must survive a flaky connection: retry up to 3 times.
      let json: any = null
      let ok = false
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const res = await authFetch('/api/location/sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          })
          json = await res.json().catch(() => null)
          ok = res.ok && !!json?.success
          if (!ok && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break
        } catch {
          // network error: retry
        }
        if (!ok) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
      if (!ok) {
        setResult({ failed: true, message: json?.error || 'Could not send SOS. Check your connection.' })
        return
      }
      setResult({ failed: false, data: json.data })
      if (json.data?.reached > 0) toast.success('SOS sent')
    } catch {
      setResult({ failed: true, message: 'Could not send SOS. Check your connection.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Siren className="h-4 w-4" />
        SOS
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResult(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{result ? (result.failed || !(result.data?.reached > 0) ? 'SOS may not have reached anyone' : 'SOS sent') : 'Send an SOS?'}</DialogTitle>
            <DialogDescription>
              {!result && 'Every parent and guardian in your family will immediately get a push, text and email with your current location.'}
              {result?.failed && result.message}
              {result && !result.failed && result.data?.notified === 0 && 'There is no one else in your family to notify yet.'}
              {result && !result.failed && result.data?.notified > 0 && result.data?.reached === 0 && 'We could not confirm delivery to anyone. Call them or emergency services directly.'}
            </DialogDescription>
          </DialogHeader>
          {result && !result.failed && result.data?.recipients?.length > 0 && (
            <ul className="space-y-1 text-sm">
              {result.data.recipients.map((r: any, i: number) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{r.name}</span>
                  <span className="text-muted-foreground">
                    {[r.sms === 'sent' && 'text', r.push === 'sent' && 'push', r.email === 'sent' && 'email'].filter(Boolean).join(', ') ||
                      (r.smsReason ? `not reached (${r.smsReason})` : 'not reached')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result && !result.failed && !result.data?.hasLocation && (
            <p className="text-sm text-amber-600">No location was available, so the alert had no map link.</p>
          )}
          <DialogFooter className="gap-2 sm:flex-col">
            <Button asChild variant="outline" className="w-full">
              <a href="tel:911">Call 911</a>
            </Button>
            {!result || result.failed || result.data?.reached === 0 ? (
              <Button variant="destructive" className="w-full" onClick={send} disabled={sending}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {result ? 'Try again' : 'Send SOS'}
              </Button>
            ) : null}
            <Button variant="ghost" className="w-full" onClick={() => { setOpen(false); setResult(null) }} disabled={sending}>
              {result ? 'Close' : 'Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
