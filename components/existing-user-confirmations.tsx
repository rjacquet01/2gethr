'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { mutate as globalMutate } from 'swr'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { authFetch, useAuth } from '@/hooks/use-auth'
import { ChildConsentBox } from '@/components/child-age'
import {
  AGE_CONFIRMATION_LABEL,
  CHILD_CONSENT_EXISTING_PROFILE_LINE,
  EXISTING_USER_CONFIRMATION_TITLE,
} from '@/lib/consent-text'

/**
 * One-time confirmations for people from before the age rule and parental
 * consent (lib/existing-user-confirmations.ts). The adult's 18+ / Terms
 * confirmation comes first; then a parent is asked about each child added
 * before consent was recorded. The API keeps working either way; only these
 * dialogs block the screen.
 */
export function ExistingUserConfirmations() {
  const { user } = useAuth()
  if (!user) return null
  if (user.needsAgeTermsConfirmation) return <AgeTermsDialog />
  return <PendingChildConsentDialog />
}

/** Blocking: confirm (stored by the server) or sign out. */
export function AgeTermsDialog() {
  const { mutate, logout } = useAuth()
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null)

  const confirm = async () => {
    setBusy('confirm')
    try {
      const res = await authFetch('/api/auth/confirm-age-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ageConfirmed, termsAccepted }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        toast.error(data.error || "Couldn't save your confirmation")
        return
      }
      await mutate()
    } finally {
      setBusy(null)
    }
  }

  const decline = async () => {
    setBusy('decline')
    await logout()
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{EXISTING_USER_CONFIRMATION_TITLE}</DialogTitle>
          <DialogDescription>
            Togethr accounts are for adults. Children join through a parent&apos;s family. Please confirm once to keep using Togethr.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <Checkbox id="existing-age-confirmed" checked={ageConfirmed} onCheckedChange={(c) => setAgeConfirmed(c === true)} className="mt-0.5" />
            <Label htmlFor="existing-age-confirmed" className="text-sm font-normal leading-snug">{AGE_CONFIRMATION_LABEL}</Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="existing-terms-accepted" checked={termsAccepted} onCheckedChange={(c) => setTermsAccepted(c === true)} className="mt-0.5" />
            <Label htmlFor="existing-terms-accepted" className="text-sm font-normal leading-snug">
              <span>
                I agree to the{' '}
                <Link href="/terms" target="_blank" className="underline hover:text-foreground">Terms of Service</Link>
                {' '}and{' '}
                <Link href="/privacy" target="_blank" className="underline hover:text-foreground">Privacy Policy</Link>
              </span>
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={decline} disabled={busy !== null}>
            {busy === 'decline' ? <Spinner className="mr-2 h-4 w-4" /> : null}
            Decline and sign out
          </Button>
          <Button onClick={confirm} disabled={!ageConfirmed || !termsAccepted || busy !== null}>
            {busy === 'confirm' ? <Spinner className="mr-2 h-4 w-4" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ChildWithoutConsent {
  familyId: string
  familyName: string
  memberId: string
  name: string
  hasLogin: boolean
}

/**
 * Parents: each child added before consent was recorded, one at a time.
 * Confirm writes a consent record; Decline offers withdrawal, which deletes
 * the child's data only after the parent confirms. Closing asks again next
 * time the app loads.
 */
export function PendingChildConsentDialog() {
  const [queue, setQueue] = useState<ChildWithoutConsent[]>([])
  const [consent, setConsent] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch('/api/families/pending-consents')
        const json = await res.json().catch(() => null)
        if (!cancelled && res.ok && json?.success) setQueue(json.data.children as ChildWithoutConsent[])
      } catch {
        // Not shown this time; asked again on the next load.
      }
    })()
    return () => { cancelled = true }
  }, [])

  const child = queue[0] ?? null
  const next = useCallback(() => {
    setConsent(false)
    setDeclining(false)
    setQueue((q) => q.slice(1))
  }, [])

  const send = async (method: 'POST' | 'DELETE') => {
    if (!child) return
    setBusy(true)
    try {
      const res = await authFetch(`/api/families/${child.familyId}/children/${child.memberId}/consent`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'POST' ? { consent } : { confirm: true }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        toast.error(json?.error || (method === 'POST' ? "Couldn't record consent" : "Couldn't withdraw consent"))
        return
      }
      toast.success(json.message || (method === 'POST' ? 'Consent recorded' : 'Consent withdrawn'))
      if (method === 'DELETE') await globalMutate(() => true)
      next()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!child} onOpenChange={(open) => { if (!open && !busy) setQueue([]) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Consent for {child?.name}</DialogTitle>
          <DialogDescription>
            {CHILD_CONSENT_EXISTING_PROFILE_LINE}
            {child && <span className="block pt-1 text-xs">{child.familyName}{child.hasLogin ? ' · has their own login' : ''}</span>}
          </DialogDescription>
        </DialogHeader>
        {declining ? (
          <div className="space-y-2 rounded-lg border border-destructive/50 p-3 text-sm">
            <p>
              Without your consent we can&apos;t keep {child?.name}&apos;s information. Withdrawing permanently deletes their profile (name, birthdate, school, notes), their login if they have one, and their location data. Events and tasks your family created stay. A record that you withdrew is kept. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeclining(false)} disabled={busy}>Back</Button>
              <Button variant="destructive" onClick={() => send('DELETE')} disabled={busy}>
                {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
                Withdraw and delete
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ChildConsentBox id="existing-child-consent" checked={consent} onCheckedChange={setConsent} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeclining(true)} disabled={busy}>Decline</Button>
              <Button onClick={() => send('POST')} disabled={!consent || busy}>
                {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
                Confirm consent
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
