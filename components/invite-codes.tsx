'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { authFetch } from '@/hooks/use-auth'
import { UserPlus, Copy, Share2, Mail, MessageSquare, X, Check, ShieldCheck, Baby, UserRound } from 'lucide-react'

type Role = 'PARENT' | 'CHILD' | 'GUEST'
type CrossFamilyRole = 'GUARDIAN' | 'GUEST'
interface Invite { code: string; role: Role; expiresAt: string }
interface JoinRequest { id: string; name: string; email?: string; crossFamily?: boolean; createdAt: string }

const roleLabel = (r: Role) => (r === 'PARENT' ? 'Parent' : r === 'GUEST' ? 'Guest' : 'Child')

function inviteMessage(familyName: string, invite: Invite) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/onboarding?code=${invite.code}` : ''
  const as = invite.role === 'PARENT' ? 'as a parent' : invite.role === 'GUEST' ? 'as a guest (calendar & tasks only)' : 'as a child'
  return `Join ${familyName} on Togethr ${as}! Tap this link: ${link}\n\nOr open the app and enter invite code: ${invite.code}\n\nThe code works once and expires in 7 days.`
}

// Create, share and cancel single-use invite codes. Each code carries a role
// (parent, child or guest) that is enforced on the server when it is used.
export function InviteCodesCard({ familyId, familyName }: { familyId: string; familyName: string }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<Role | null>(null)
  const [forbidden, setForbidden] = useState(false)

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

  const create = async (role: Role) => {
    setCreating(role)
    try {
      const res = await authFetch(`/api/families/${familyId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not create code'); return }
      toast.success(`${roleLabel(role)} code created`)
      await load()
    } catch {
      toast.error('Could not create code')
    } finally {
      setCreating(null)
    }
  }

  const cancel = async (code: string) => {
    const res = await authFetch(`/api/families/${familyId}/invite?code=${encodeURIComponent(code)}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Code cancelled'); load() } else toast.error('Could not cancel code')
  }

  const copy = (inv: Invite) => {
    navigator.clipboard.writeText(inv.code)
    toast.success('Code copied')
  }
  const email = (inv: Invite) => {
    const subject = encodeURIComponent(`Join ${familyName} on Togethr`)
    window.open(`mailto:?subject=${subject}&body=${encodeURIComponent(inviteMessage(familyName, inv))}`, '_blank')
  }
  const sms = (inv: Invite) => window.open(`sms:?body=${encodeURIComponent(inviteMessage(familyName, inv))}`, '_blank')
  const share = async (inv: Invite) => {
    if (navigator.share) {
      try { await navigator.share({ title: `Join ${familyName} on Togethr`, text: inviteMessage(familyName, inv) }) }
      catch (e) { if ((e as Error).name !== 'AbortError') toast.error('Failed to share') }
    } else copy(inv)
  }

  if (forbidden) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          Invite Family Members
        </CardTitle>
        <CardDescription>
          Choose who you are inviting. Each code works once, expires in 7 days, and sets the account type, so a child can never join as a parent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => create('PARENT')} disabled={creating !== null}>
            {creating === 'PARENT' ? <Spinner className="w-4 h-4 mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2 shrink-0" />}
            <span>
              <span className="block font-medium">New parent code</span>
              <span className="block text-xs text-muted-foreground font-normal">A parent approves them before they get in</span>
            </span>
          </Button>
          <Button variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => create('CHILD')} disabled={creating !== null}>
            {creating === 'CHILD' ? <Spinner className="w-4 h-4 mr-2" /> : <Baby className="w-4 h-4 mr-2 shrink-0" />}
            <span>
              <span className="block font-medium">New child code</span>
              <span className="block text-xs text-muted-foreground font-normal">Joins right away with child permissions</span>
            </span>
          </Button>
          <Button variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => create('GUEST')} disabled={creating !== null}>
            {creating === 'GUEST' ? <Spinner className="w-4 h-4 mr-2" /> : <UserRound className="w-4 h-4 mr-2 shrink-0" />}
            <span>
              <span className="block font-medium">Guest (calendar &amp; tasks only)</span>
              <span className="block text-xs text-muted-foreground font-normal">Joins right away, no location or places</span>
            </span>
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-2"><Spinner className="w-4 h-4" /></div>
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unused codes. Create one above.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.code} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-lg tracking-wider">{inv.code}</div>
                  <div className="text-xs text-muted-foreground">
                    {roleLabel(inv.role)} code · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => copy(inv)} title="Copy code"><Copy className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => email(inv)} title="Share via email"><Mail className="w-4 h-4" /></Button>
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
export function JoinRequestsCard({ familyId }: { familyId: string }) {
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
