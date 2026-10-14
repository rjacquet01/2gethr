'use client'

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { BellRing, Loader2 } from 'lucide-react'

interface Child { memberId: string; name: string }

/**
 * Parent/guardian -> child "call or reply now" alert (Premium). Only renders for
 * a parent or guardian whose family has at least one child with an account.
 */
export function EmergencyAlertButton({ familyId }: { familyId?: string }) {
  const [state, setState] = useState<{ eligible: boolean; reason?: string; children: Child[] } | null>(null)
  const [open, setOpen] = useState(false)
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const load = useCallback(async () => {
    if (!familyId) return
    try {
      const res = await authFetch(`/api/location/emergency-alert?familyId=${encodeURIComponent(familyId)}`)
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) setState(json.data)
    } catch {
      // button simply stays hidden
    }
  }, [familyId])

  useEffect(() => { load() }, [load])

  const send = async (child: Child) => {
    setSendingTo(child.memberId)
    try {
      const res = await authFetch('/api/location/emergency-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId, memberId: child.memberId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setResults((r) => ({ ...r, [child.memberId]: { ok: false, message: json?.error || 'Could not send the alert. Call them directly.' } }))
        return
      }
      const d = json.data
      const channels = [d.push === 'sent' && 'push', d.sms === 'sent' && 'text'].filter(Boolean).join(' and ')
      setResults((r) => ({
        ...r,
        [child.memberId]: d.reached
          ? { ok: true, message: `Alert delivered by ${channels}. Call ${child.name} if you don't hear back.` }
          : { ok: false, message: `${child.name} may not have received it (${d.smsReason || 'no phone or app signed in'}). Call them directly.` },
      }))
      if (d.reached) toast.success(`Alert sent to ${child.name}`)
    } catch {
      setResults((r) => ({ ...r, [child.memberId]: { ok: false, message: 'Could not send the alert. Check your connection and call them directly.' } }))
    } finally {
      setSendingTo(null)
    }
  }

  if (!state || (!state.eligible && state.reason !== 'UPGRADE')) return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <BellRing className="h-4 w-4" />
        Alert child
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResults({}) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send an emergency alert?</DialogTitle>
            <DialogDescription>
              {state.eligible
                ? 'Your child gets an urgent push and a text asking them to call or reply right now. Use this only in an emergency.'
                : 'Emergency alerts to your child are part of the Premium plan. Upgrade your family plan to use them.'}
            </DialogDescription>
          </DialogHeader>
          {state.eligible && (
            <ul className="space-y-3">
              {state.children.map((c) => (
                <li key={c.memberId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    <Button variant="destructive" size="sm" onClick={() => send(c)} disabled={sendingTo !== null}>
                      {sendingTo === c.memberId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {results[c.memberId] ? 'Send again' : 'Send alert'}
                    </Button>
                  </div>
                  {results[c.memberId] && (
                    <p className={`text-sm ${results[c.memberId].ok ? 'text-muted-foreground' : 'text-amber-600'}`}>{results[c.memberId].message}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter className="gap-2 sm:flex-col">
            <Button asChild variant="outline" className="w-full">
              <a href="tel:911">Call 911</a>
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => { setOpen(false); setResults({}) }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
