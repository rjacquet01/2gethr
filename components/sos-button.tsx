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

  const send = async () => {
    setSending(true)
    try {
      // Use a fresh fix when the browser can give one quickly; the server
      // falls back to the last stored location otherwise.
      const pos = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null)
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 })
      })
      const res = await authFetch('/api/location/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId,
          latitude: pos?.coords.latitude,
          longitude: pos?.coords.longitude,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        toast.error(json?.error || 'Could not send SOS')
        return
      }
      toast.success(json.data?.notified > 0 ? 'SOS sent to your family' : 'SOS sent, but there is no one to notify yet')
      setOpen(false)
    } catch {
      toast.error('Could not send SOS')
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send an SOS?</DialogTitle>
            <DialogDescription>
              Every parent and guardian in your family will immediately get a push, text and email with your current location.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={send} disabled={sending}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send SOS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
