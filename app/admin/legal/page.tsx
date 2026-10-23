'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Scale, Plus, AlertTriangle } from 'lucide-react'

const api = (url: string, init: RequestInit = {}) =>
  fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminAccessToken()}`, ...(init.headers || {}) },
  })

interface CaseRow {
  id: string; caseNumber: string; type: string; status: string; agency: string; requesterName: string
  openedAt: string; accessActive: boolean; accessExpiresAt: string | null
  emergencyReviewStatus: string | null; emergencyReviewOverdue: boolean
}
interface AdminRow { id: string; email: string; name: string; status: string; hasLegal: boolean }

const TYPES = [
  ['SUBPOENA', 'Subpoena'], ['WARRANT', 'Search warrant'], ['COURT_ORDER', 'Court order'],
  ['EMERGENCY', 'Emergency (imminent danger, e.g. missing child)'],
]

export default function LegalRequestsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [cases, setCases] = useState<CaseRow[] | null>(null)
  const [denied, setDenied] = useState('')
  const [admins, setAdmins] = useState<AdminRow[] | null>(null)
  const [meId, setMeId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [f, setF] = useState<Record<string, any>>({ type: 'SUBPOENA' })
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    const r = await api('/api/admin/legal')
    const d = await r.json().catch(() => ({}))
    if (r.ok) { setCases(d.data); setDenied('') } else { setCases(null); setDenied(d.error || 'No access') }
    const a = await api('/api/admin/legal/grant')
    if (a.ok) { const ad = await a.json(); setAdmins(ad.data); setMeId(ad.me.id) } else setAdmins(null)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const toggleRole = async (id: string, grant: boolean) => {
    const r = await api('/api/admin/legal/grant', { method: 'POST', body: JSON.stringify({ adminId: id, grant }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) toast.error(d.error || 'Failed'); else toast.success(grant ? 'Legal role granted' : 'Legal role removed')
    load()
  }

  const submit = async () => {
    setSaving(true)
    const body = {
      ...f,
      scopeFrom: f.scopeFrom ? new Date(f.scopeFrom).toISOString() : '',
      scopeTo: f.scopeTo ? new Date(f.scopeTo).toISOString() : '',
    }
    const r = await api('/api/admin/legal', { method: 'POST', body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    setSaving(false)
    if (!r.ok) { toast.error(d.error || 'Could not open case'); return }
    toast.success(`Opened ${d.data.caseNumber}`)
    router.push(`/admin/legal/${d.data.id}`)
  }

  if (loading) return <div className="p-8 flex justify-center"><Spinner className="w-6 h-6" /></div>
  const emergency = f.type === 'EMERGENCY'
  const overdue = (cases || []).filter((c) => c.emergencyReviewOverdue)

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="w-6 h-6" /> Legal Requests</h1>
          <p className="text-sm text-muted-foreground">Law-enforcement and court requests. No one has standing access to user location or account data; access exists only through an approved case.</p>
        </div>
        {cases && <Button onClick={() => setShowForm((s) => !s)}><Plus className="w-4 h-4 mr-1" />New case</Button>}
      </div>

      {!cases && (
        <Card><CardContent className="py-6 text-sm">
          <p>{denied}</p>
          {admins && <p className="mt-2 text-muted-foreground">As a super admin you can assign the Legal Compliance role below. Two different people with that role are needed: one opens a case, another approves it.</p>}
        </CardContent></Card>
      )}

      {overdue.length > 0 && (
        <Card className="border-destructive/50"><CardContent className="py-4 text-sm flex gap-2 items-start">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
          <span>{overdue.length} emergency disclosure{overdue.length > 1 ? 's are' : ' is'} past the 72-hour review deadline: {overdue.map((c) => c.caseNumber).join(', ')}.</span>
        </CardContent></Card>
      )}

      {cases && showForm && (
        <Card>
          <CardHeader><CardTitle>Open a case</CardTitle><CardDescription>Record who is asking, under what authority, and exactly what they are entitled to.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Type</Label>
              <select className="w-full border rounded-md h-10 px-3 bg-background" value={f.type} onChange={(e) => set('type', e.target.value)}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Agency</Label><Input value={f.agency || ''} onChange={(e) => set('agency', e.target.value)} /></div>
              <div className="space-y-1"><Label>Requester name and title</Label><Input value={f.requesterName || ''} onChange={(e) => set('requesterName', e.target.value)} /></div>
              <div className="space-y-1"><Label>Requester contact (email / phone)</Label><Input value={f.requesterContact || ''} onChange={(e) => set('requesterContact', e.target.value)} /></div>
              <div className="space-y-1"><Label>Their reference (docket / warrant / case no.)</Label><Input value={f.referenceNumber || ''} onChange={(e) => set('referenceNumber', e.target.value)} /></div>
            </div>
            {!emergency ? (
              <div className="space-y-1"><Label>Legal document reference</Label><Input placeholder="Where the signed copy is stored, and its date" value={f.documentRef || ''} onChange={(e) => set('documentRef', e.target.value)} /></div>
            ) : (
              <div className="space-y-1"><Label>Nature of the imminent danger</Label><Textarea placeholder="What was reported, by whom, and why delay could cost a life or cause serious harm. This is reviewed by a second person within 72 hours." value={f.emergencyReason || ''} onChange={(e) => set('emergencyReason', e.target.value)} /></div>
            )}
            <div className="space-y-1"><Label>Summary (optional)</Label><Textarea value={f.summary || ''} onChange={(e) => set('summary', e.target.value)} /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Person covered: account email</Label><Input value={f.userEmail || ''} onChange={(e) => set('userEmail', e.target.value)} /></div>
              <div className="space-y-1"><Label>Family ID (optional if a person is named)</Label><Input value={f.familyId || ''} onChange={(e) => set('familyId', e.target.value)} /></div>
              <div className="space-y-1"><Label>Data from</Label><Input type="datetime-local" value={f.scopeFrom || ''} onChange={(e) => set('scopeFrom', e.target.value)} /></div>
              <div className="space-y-1"><Label>Data to</Label><Input type="datetime-local" value={f.scopeTo || ''} onChange={(e) => set('scopeTo', e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.includesLivePing} onChange={(e) => set('includesLivePing', e.target.checked)} /> The order covers a live location ping</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.nondisclosure} onChange={(e) => set('nondisclosure', e.target.checked)} /> Non-disclosure instruction (do not notify the family)</label>
            <div className="flex gap-2">
              <Button onClick={submit} disabled={saving}>{saving ? <Spinner className="w-4 h-4" /> : emergency ? 'Open emergency case (access starts now)' : 'Open case'}</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {cases && (
        <Card>
          <CardHeader><CardTitle>Cases</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {cases.length === 0 && <p className="text-sm text-muted-foreground">No cases yet.</p>}
            {cases.map((c) => (
              <Link key={c.id} href={`/admin/legal/${c.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{c.caseNumber} <span className="text-muted-foreground font-normal">· {c.agency}</span></div>
                  <div className="text-xs text-muted-foreground">{c.type.replace('_', ' ')} · opened {new Date(c.openedAt).toLocaleString()}</div>
                </div>
                {c.emergencyReviewOverdue && <Badge variant="destructive">Review overdue</Badge>}
                {c.accessActive && <Badge>Access open</Badge>}
                <Badge variant="outline">{c.status}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {admins && (
        <Card>
          <CardHeader><CardTitle>Legal team (super admin)</CardTitle><CardDescription>The Legal Compliance role is not included in Super Admin. Assign it deliberately; every change is logged.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex-1 min-w-0"><div className="font-medium truncate">{a.name || a.email}</div><div className="text-xs text-muted-foreground truncate">{a.email}</div></div>
                {a.hasLegal && <Badge>Legal</Badge>}
                <Button size="sm" variant="outline" disabled={a.status !== 'ACTIVE'} onClick={() => toggleRole(a.id, !a.hasLegal)}>{a.hasLegal ? 'Remove' : 'Grant'}</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
