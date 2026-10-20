'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
import { authFetch } from '@/hooks/use-auth'
import { CHILD_CONSENT_STATEMENT, CHILD_DATA_NOTICE } from '@/lib/consent-text'

/**
 * The parent's consent for a child profile or child account: the short
 * "what we collect from your child" notice and a checkbox that starts
 * unchecked. The server refuses the request without it and stores this text.
 */
export function ChildConsentBox({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">What we collect from your child</p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {CHILD_DATA_NOTICE.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <label htmlFor={id} className="flex items-start gap-3 pt-1">
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} className="mt-0.5" />
        <span>{CHILD_CONSENT_STATEMENT}</span>
      </label>
      <p className="text-xs text-muted-foreground">
        See our <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link> (section 6, children).
      </p>
    </div>
  )
}
import { Cake, Check, Copy, KeyRound, Shield, UserCheck, Baby } from 'lucide-react'

export interface AgeAwareChild {
  id: string
  displayName: string
  familyMemberId?: string
  hasLogin?: boolean
  dateOfBirth?: string | null
  age?: number | null
  canHaveAccount?: boolean
  turns18On?: string | null
  daysUntil18?: number | null
  needsRoleChoice?: boolean
}

/** "March 1, 2026" from a YYYY-MM-DD date (no time zone shift). */
export function formatYmd(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

/** Today as YYYY-MM-DD, for the date input's max. */
export function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Birthdate field used by the Add Child dialog and the child edit form. */
export function BirthdateInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Birthdate (optional)</Label>
      <Input id={id} type="date" max={todayYmd()} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted-foreground">Used to show their age, remind you before they turn 18, and allow their own account from age 8.</p>
    </div>
  )
}

/** "Turns 18 on <date>" chip, shown in the last 60 days before. */
export function Turns18Chip({ child }: { child: AgeAwareChild }) {
  if (!child.turns18On || child.daysUntil18 == null || child.daysUntil18 <= 0 || child.daysUntil18 > 60) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <Cake className="h-3 w-3" />
      Turns 18 on {formatYmd(child.turns18On)}
    </span>
  )
}

/**
 * Parents only: the 18th-birthday decision for one child. Guardian or Adult
 * promotes them (the server checks they have a login and a birthdate showing
 * 18+); "Keep as child" hides the card for 30 days.
 */
export function RoleChoiceCard({
  familyId,
  child,
  onChanged,
  onCreateAccount,
}: {
  familyId: string
  child: AgeAwareChild
  onChanged: () => void
  onCreateAccount: (child: AgeAwareChild) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const memberId = child.familyMemberId

  const act = async (kind: 'GUARDIAN' | 'ADULT' | 'SNOOZE') => {
    if (!memberId) return
    setBusy(kind)
    try {
      const res = await authFetch(`/api/families/${familyId}/members/${memberId}/${kind === 'SNOOZE' ? 'snooze' : 'promote'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'SNOOZE' ? {} : { to: kind }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not save that')
        return
      }
      toast.success(
        kind === 'SNOOZE'
          ? `${child.displayName} stays a child member. We'll ask again in 30 days.`
          : `${child.displayName} is now ${kind === 'GUARDIAN' ? 'a Guardian' : 'an Adult'} member`
      )
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border-primary/50 bg-primary/5 py-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Cake className="h-5 w-5 text-primary" />
          <p className="font-semibold">{child.displayName} is 18</p>
        </div>
        {!child.hasLogin ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Invite them to create an account first. You can choose their role once they join.</p>
            <Button size="sm" variant="outline" onClick={() => onCreateAccount(child)}>
              <KeyRound className="mr-1.5 h-4 w-4" />
              Create account
            </Button>
          </div>
        ) : !child.dateOfBirth ? (
          <p className="text-sm text-muted-foreground">
            Add their birthdate on{' '}
            <Link href={`/family/child/${child.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
              their profile
            </Link>{' '}
            to choose their role.
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li><span className="font-medium text-foreground">Guardian</span> - helps look after the children, like a parent but can&apos;t manage the family.</li>
              <li><span className="font-medium text-foreground">Adult</span> - a grown-up member with their own calendar, tasks and places, but no say over the children.</li>
              <li><span className="font-medium text-foreground">Keep as child</span> - nothing changes for now; we&apos;ll ask again in 30 days.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => act('GUARDIAN')}>
                {busy === 'GUARDIAN' ? <Spinner className="mr-1.5 h-4 w-4" /> : <Shield className="mr-1.5 h-4 w-4" />}
                Guardian
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => act('ADULT')}>
                {busy === 'ADULT' ? <Spinner className="mr-1.5 h-4 w-4" /> : <UserCheck className="mr-1.5 h-4 w-4" />}
                Adult
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('SNOOZE')}>
                {busy === 'SNOOZE' ? <Spinner className="mr-1.5 h-4 w-4" /> : <Baby className="mr-1.5 h-4 w-4" />}
                Keep as child
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Parent consent, then a single-use code + join link that links whoever uses
 * it to this child's existing profile.
 */
export function ChildAccountDialog({
  familyId,
  child,
  onOpenChange,
}: {
  familyId: string
  child: AgeAwareChild | null
  onOpenChange: (open: boolean) => void
}) {
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ code: string; joinLink: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const close = (open: boolean) => {
    if (!open) {
      setConsent(false)
      setResult(null)
      setCopied(false)
    }
    onOpenChange(open)
  }

  const create = async () => {
    if (!child?.familyMemberId) return
    setBusy(true)
    try {
      const res = await authFetch(`/api/families/${familyId}/children/${child.familyMemberId}/account-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not create the account invite')
        return
      }
      setResult({ code: data.data.code, joinLink: data.data.joinLink })
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(`${result.joinLink}\n\nCode: ${result.code}`)
    setCopied(true)
    toast.success('Link and code copied')
    setTimeout(() => setCopied(false), 2000)
  }

  const under13 = child?.age != null && child.age < 13

  return (
    <Dialog open={!!child} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an account for {child?.displayName}</DialogTitle>
          <DialogDescription>
            They get their own sign-in, joined to their existing profile. Location sharing stays off until it&apos;s turned on.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg border p-3">
              <div className="font-mono text-lg tracking-wider">{result.code}</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">{result.joinLink}</div>
            </div>
            <p className="text-xs text-muted-foreground">Open the link on their device and sign up. The code works once and expires in 7 days.</p>
            <Button className="w-full" onClick={copy}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              Copy link and code
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <ChildConsentBox id="child-account-consent" checked={consent} onCheckedChange={setConsent} />
            {under13 && (
              <p className="text-xs text-muted-foreground">
                Because {child?.displayName} is under 13, their account is created only with your consent, and we only use their information to run the family features.
              </p>
            )}
          </div>
        )}
        {!result && (
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button onClick={create} disabled={!consent || busy}>
              {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Create invite
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface ConsentRecord {
  id: string
  scope: 'CHILD_PROFILE' | 'CHILD_ACCOUNT'
  version: string
  text: string
  grantedAt: string
  withdrawnAt: string | null
  grantedBy: string
}

/**
 * A parent reviews the consent given for a child and can withdraw it.
 * Withdrawing deletes the child's profile, login and location data.
 */
export function ChildConsentDialog({
  familyId,
  child,
  onOpenChange,
  onWithdrawn,
}: {
  familyId: string
  child: { memberId: string; name: string } | null
  onOpenChange: (open: boolean) => void
  onWithdrawn: () => void
}) {
  const [records, setRecords] = useState<ConsentRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setRecords(null)
    setLoadError(null)
    setConfirming(false)
    if (!child) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch(`/api/families/${familyId}/children/${child.memberId}/consent`)
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.success) setLoadError(json?.error || "Couldn't load consent")
        else setRecords(json.data.records as ConsentRecord[])
      } catch {
        if (!cancelled) setLoadError("Couldn't load consent")
      }
    })()
    return () => { cancelled = true }
  }, [familyId, child])

  const withdraw = async () => {
    if (!child) return
    setBusy(true)
    try {
      const res = await authFetch(`/api/families/${familyId}/children/${child.memberId}/consent`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        toast.error(json?.error || "Couldn't withdraw consent")
        return
      }
      toast.success(json.message || 'Consent withdrawn')
      onWithdrawn()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const fmt = (d: string) => new Date(d).toLocaleString()
  return (
    <Dialog open={!!child} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Consent for {child?.name}</DialogTitle>
          <DialogDescription>What you agreed to when {child?.name} was added, and when.</DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : records === null ? (
          <div className="flex justify-center py-4"><Spinner className="h-5 w-5" /></div>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No consent is on record for {child?.name}. They were added before consent was recorded. You can withdraw below, or contact admin@mytogethr.com.
          </p>
        ) : (
          <ul className="space-y-3">
            {records.map((r) => (
              <li key={r.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {r.scope === 'CHILD_ACCOUNT' ? 'Their own account' : 'Child profile'} · {r.grantedBy} · {fmt(r.grantedAt)}
                </p>
                {r.withdrawnAt && <p className="text-xs text-destructive">Withdrawn {fmt(r.withdrawnAt)}</p>}
                <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{r.text}</p>
              </li>
            ))}
          </ul>
        )}
        {confirming ? (
          <div className="space-y-2 rounded-lg border border-destructive/50 p-3 text-sm">
            <p>
              Withdrawing consent permanently deletes {child?.name}&apos;s profile (name, birthdate, school, notes), their login if they have one, and their location data. Events and tasks your family created stay. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" onClick={withdraw} disabled={busy}>
                {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
                Withdraw and delete
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button variant="destructive" onClick={() => setConfirming(true)} disabled={records === null && !loadError}>
              Withdraw consent
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
