'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { authFetch } from '@/hooks/use-auth'
import { BirthdateInput, ChildConsentBox } from '@/components/child-age'
import { UserPlus, Copy, Share2, Mail, MessageSquare, X, Check, ShieldCheck, UserRound, Baby } from 'lucide-react'

type Role = 'PARENT' | 'CHILD' | 'GUEST'
type CrossFamilyRole = 'GUARDIAN' | 'GUEST'
interface Invite { code: string; role: Role; childName?: string | null; expiresAt: string }
interface JoinRequest { id: string; name: string; email?: string; crossFamily?: boolean; createdAt: string }
interface Sent { role: Role; code: string; joinLink: string; emailedTo: string | null; emailError: string | null }

const roleLabel = (r: Role) => (r === 'PARENT' ? 'Parent' : r === 'GUEST' ? 'Guest' : 'Child')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function inviteMessage(familyName: string, invite: Pick<Invite, 'code' | 'role'>) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/onboarding?code=${invite.code}` : ''
  const as = invite.role === 'PARENT' ? 'as a parent' : invite.role === 'GUEST' ? 'as a guest (calendar & tasks only)' : 'with your own account'
  return `Join ${familyName} on Togethr ${as}! Tap this link: ${link}\n\nOr open the app and enter invite code: ${invite.code}\n\nThe code works once and expires in 7 days.`
}

const CHOICES: { role: Role; title: string; hint: string; Icon: typeof ShieldCheck }[] = [
  { role: 'PARENT', title: 'Parent', hint: 'Another parent approves them before they get in', Icon: ShieldCheck },
  { role: 'CHILD', title: 'Child', hint: 'Their own sign-in on their phone, with your consent', Icon: Baby },
  { role: 'GUEST', title: 'Guest', hint: 'Calendar & tasks only, no location or places', Icon: UserRound },
]

// Invite someone by email: Parent, Child or Guest. Each invite is a single-use
// code bound to that role on the server, emailed as a link; the person creates
// an account (or signs in) and joins. A child's invite also creates their
// child profile with the parent's consent, and their account joins it. Kids
// without their own email are added with Add child instead.
export function InviteCodesCard({ familyId, familyName, canInviteChild = false, onChildAdded }: {
  familyId: string
  familyName: string
  /** Only parents add children (and so invite them). */
  canInviteChild?: boolean
  onChildAdded?: () => void
}) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [role, setRole] = useState<Role | null>(null)
  const [email, setEmail] = useState('')
  const [childName, setChildName] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<Sent | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/families/${familyId}/invite`)
      if (res.status === 403) { setForbidden(true); return }
      const data = await res.json()
      if (res.ok) setInvites(data.data || [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => { load() }, [load])

  const pick = (r: Role) => {
    setRole(r)
    setSent(null)
    setEmail('')
    setChildName('')
    setBirthdate('')
    setConsent(false)
  }

  const emailOk = EMAIL_RE.test(email.trim())
  const ready = !!role && emailOk && (role !== 'CHILD' || (childName.trim().length > 0 && consent))

  const send = async () => {
    if (!role || !ready) return
    setSending(true)
    try {
      let data: { code: string; joinLink: string; emailed?: boolean; emailError?: string }
      if (role === 'CHILD') {
        // 1) The child's profile, with the parent's consent (like Add child).
        const addRes = await authFetch(`/api/families/${familyId}/children`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: childName.trim(), dateOfBirth: birthdate || null, consent: true }),
        })
        const added = await addRes.json().catch(() => ({}))
        if (!addRes.ok) { toast.error(added.error || 'Could not add the child'); return }
        onChildAdded?.()
        // 2) Their single-use account invite, emailed to them.
        const res = await authFetch(`/api/families/${familyId}/children/${added.data.memberId}/account-invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consent: true, email: email.trim() }),
        })
        const out = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(`${childName.trim()} was added, but the invite failed: ${out.error || 'try again from Manage members'}`)
          return
        }
        data = out.data
      } else {
        const res = await authFetch(`/api/families/${familyId}/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, email: email.trim() }),
        })
        const out = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(out.error || 'Could not create the invite'); return }
        data = out.data
      }
      setSent({ role, code: data.code, joinLink: data.joinLink, emailedTo: data.emailed ? email.trim() : null, emailError: data.emailError || null })
      if (data.emailed) toast.success(`Invite emailed to ${email.trim()}`)
      await load()
    } catch {
      toast.error('Could not create the invite')
    } finally {
      setSending(false)
    }
  }

  const cancel = async (code: string) => {
    const res = await authFetch(`/api/families/${familyId}/invite?code=${encodeURIComponent(code)}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Code cancelled'); load() } else toast.error('Could not cancel code')
  }

  const copy = (inv: Pick<Invite, 'code' | 'role'>) => {
    navigator.clipboard.writeText(inviteMessage(familyName, inv))
    toast.success('Invite link and code copied')
  }
  const mailto = (inv: Invite) => {
    const subject = encodeURIComponent(`Join ${familyName} on Togethr`)
    window.open(`mailto:?subject=${subject}&body=${encodeURIComponent(inviteMessage(familyName, inv))}`, '_blank')
  }
  const sms = (inv: Pick<Invite, 'code' | 'role'>) => window.open(`sms:?body=${encodeURIComponent(inviteMessage(familyName, inv))}`, '_blank')
  const share = async (inv: Pick<Invite, 'code' | 'role'>) => {
    if (navigator.share) {
      try { await navigator.share({ title: `Join ${familyName} on Togethr`, text: inviteMessage(familyName, inv) }) }
      catch (e) { if ((e as Error).name !== 'AbortError') toast.error('Failed to share') }
    } else copy(inv)
  }

  if (forbidden) return null
  const choices = CHOICES.filter((c) => c.role !== 'CHILD' || canInviteChild)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          Invite Family Members
        </CardTitle>
        <CardDescription>
          We email them a link to create their account and join. Each invite works once and expires in 7 days.
          {canInviteChild && ' For a child without their own email, use Add child instead.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`grid gap-2 ${choices.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} role="radiogroup" aria-label="Who are you inviting?">
          {choices.map(({ role: r, title, hint, Icon }) => (
            <Button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              variant={role === r ? 'default' : 'outline'}
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => pick(r)}
            >
              <Icon className="w-4 h-4 mr-2 shrink-0" />
              <span>
                <span className="block font-medium">{title}</span>
                <span className={`block text-xs font-normal ${role === r ? 'opacity-80' : 'text-muted-foreground'}`}>{hint}</span>
              </span>
            </Button>
          ))}
        </div>

        {role && !sent && (
          <div className="space-y-3 rounded-lg border p-3">
            {role === 'CHILD' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-child-name">Child&apos;s name</Label>
                  <Input id="invite-child-name" value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="Their first name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-child-birthdate">Birthdate (optional)</Label>
                  <BirthdateInput id="invite-child-birthdate" value={birthdate} onChange={setBirthdate} />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{role === 'CHILD' ? "Child's email" : `${roleLabel(role)}'s email`}</Label>
              <Input
                id="invite-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
              {email.trim() && !emailOk && <p className="text-xs text-destructive">Enter a valid email address</p>}
              <p className="text-xs text-muted-foreground">Used only to send the invite. They choose their sign-in email when they sign up.</p>
            </div>
            {role === 'CHILD' && <ChildConsentBox id="invite-child-consent" checked={consent} onCheckedChange={setConsent} />}
            <Button className="w-full" onClick={send} disabled={!ready || sending}>
              {sending ? <Spinner className="w-4 h-4 mr-2" /> : <Mail className="w-4 h-4 mr-2" />}
              Send {roleLabel(role).toLowerCase()} invite
            </Button>
          </div>
        )}

        {sent && (
          <div className="space-y-3 rounded-lg border p-3">
            {sent.emailedTo && (
              <p className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 shrink-0 text-green-600" />
                {roleLabel(sent.role)} invite emailed to {sent.emailedTo}
              </p>
            )}
            {sent.emailError && <p className="text-sm text-destructive">{sent.emailError}</p>}
            <div>
              <div className="font-mono text-lg tracking-wider">{sent.code}</div>
              <div className="break-all text-xs text-muted-foreground">{sent.joinLink}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => share(sent)}><Share2 className="mr-1.5 h-4 w-4" />Share link</Button>
              <Button size="sm" variant="outline" onClick={() => copy(sent)}><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
              <Button size="sm" variant="ghost" onClick={() => pick(sent.role)}>Invite someone else</Button>
            </div>
          </div>
        )}

        <p className="text-sm font-medium">Unused invites</p>
        {loading ? (
          <div className="flex justify-center py-2"><Spinner className="w-4 h-4" /></div>
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">None. Send one above.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.code} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-lg tracking-wider">{inv.code}</div>
                  <div className="text-xs text-muted-foreground">
                    {roleLabel(inv.role)}{inv.childName ? ` (${inv.childName})` : ''} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => copy(inv)} title="Copy link and code"><Copy className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => mailto(inv)} title="Share via your email app"><Mail className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => sms(inv)} title="Share via text"><MessageSquare className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => share(inv)} title="More options"><Share2 className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => cancel(inv.code)} title="Cancel code"><X className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Parents approve or decline people who joined with a parent code. Someone
// who already belongs to another family is approved as a Guardian or a Guest
// (default Guest), never as a Parent.
export function JoinRequestsCard({ familyId, onAnswered }: { familyId: string; onAnswered?: () => void }) {
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [grantRoles, setGrantRoles] = useState<Record<string, CrossFamilyRole>>({})

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/families/${familyId}/join-requests`)
      if (!res.ok) return
      const data = await res.json()
      setRequests(data.data || [])
    } catch {
      /* ignore */
    }
  }, [familyId])

  useEffect(() => { load() }, [load])

  const answer = async (r: JoinRequest, action: 'approve' | 'deny') => {
    const id = r.id
    const grantRole: CrossFamilyRole | undefined = r.crossFamily ? grantRoles[id] || 'GUEST' : undefined
    setBusy(id)
    try {
      const res = await authFetch(`/api/families/${familyId}/join-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(grantRole ? { grantRole } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.error || 'Could not save your answer')
      else if (action === 'deny') toast.success('Request declined')
      else toast.success(grantRole === 'GUARDIAN' ? 'Guardian approved' : grantRole === 'GUEST' ? 'Guest approved' : 'Parent approved')
      // The page's member list and counts change with an approval.
      if (res.ok) onAnswered?.()
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (requests.length === 0) return null

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          Waiting for your approval
        </CardTitle>
        <CardDescription>These people used a parent invite code. They get no access until a parent approves.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{r.name}</div>
              {r.email && <div className="text-xs text-muted-foreground truncate">{r.email}</div>}
              {r.crossFamily && (
                <div className="mt-2">
                  <div className="text-xs text-muted-foreground">Already in another family. Approve as:</div>
                  <div className="mt-1 inline-flex rounded-md border p-0.5" role="radiogroup" aria-label="Approve as">
                    {(['GUEST', 'GUARDIAN'] as const).map((opt) => {
                      const selected = (grantRoles[r.id] || 'GUEST') === opt
                      return (
                        <button
                          key={opt}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setGrantRoles((g) => ({ ...g, [r.id]: opt }))}
                          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                        >
                          {opt === 'GUEST' ? 'Guest' : 'Guardian'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => answer(r, 'deny')}>Decline</Button>
            <Button size="sm" disabled={busy === r.id} onClick={() => answer(r, 'approve')}>
              {busy === r.id ? <Spinner className="w-4 h-4" /> : <Check className="w-4 h-4 mr-1" />}
              Approve
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
