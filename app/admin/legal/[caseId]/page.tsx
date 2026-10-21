'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { ArrowLeft, Download, Send } from 'lucide-react'

const api = (url: string, init: RequestInit = {}) =>
  fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminAccessToken()}`, ...(init.headers || {}) },
  })

const SECTIONS = [
  ['account', 'Account'], ['location', 'Location history'], ['geofence', 'Place alerts'], ['requests', 'Ping requests'],
  ['activity', 'Activity log'], ['devices', 'Devices & IPs'], ['safety', 'SOS & emergencies'], ['places', 'Saved places'],
  ['billing', 'Subscriber & billing'],
]
const PING_STATUS: Record<string, string> = { PENDING: 'Waiting for the phone', FULFILLED: 'Answered', NO_ANSWER: 'No answer (phone offline or not sharing)' }
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : '-')

export default function LegalCasePage() {
  const { caseId } = useParams<{ caseId: string }>()
  const [c, setC] = useState<any>(null)
  const [me, setMe] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')
  const [hours, setHours] = useState('72')
  const [section, setSection] = useState('account')
  const [data, setData] = useState<any>(null)
  const [dataLoading, setDataLoading] = useState(false)

  const load = useCallback(async () => {
    const r = await api(`/api/admin/legal/${caseId}`)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(d.error || 'Not found'); return }
    setC(d.data); setMe(d.me)
  }, [caseId])
  useEffect(() => { load() }, [load])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    const r = await api(`/api/admin/legal/${caseId}`, { method: 'POST', body: JSON.stringify({ action, ...extra }) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) toast.error(d.error || 'Failed'); else { toast.success('Done'); setNotes('') }
    load()
  }

  const loadData = async (s: string, offset = 0) => {
    setSection(s); setDataLoading(true)
    const r = await api(`/api/admin/legal/${caseId}/data?section=${s}&offset=${offset}`)
    const d = await r.json().catch(() => ({}))
    setDataLoading(false)
    if (!r.ok) { toast.error(d.error || 'Failed'); setData(null); load(); return }
    setData({ ...d.data, offset })
    load()
  }

  const exportFile = async () => {
    setBusy(true)
    const r = await api(`/api/admin/legal/${caseId}/export`, { method: 'POST' })
    setBusy(false)
    if (!r.ok) { const d = await r.json().catch(() => ({})); toast.error(d.error || 'Export failed'); return }
    const hash = r.headers.get('X-Content-SHA256')
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `${c.caseNumber}.json`; a.click()
    toast.success(`Exported. SHA-256 ${hash?.slice(0, 16)}…`)
    load()
  }

  const [pingInfo, setPingInfo] = useState<{ people: any[]; pings: any[] } | null>(null)
  const [pingUser, setPingUser] = useState('')
  const canPing = c && c.accessActive && (c.includesLivePing || c.type === 'EMERGENCY')

  const loadPings = useCallback(async () => {
    const r = await api(`/api/admin/legal/${caseId}/ping`)
    const d = await r.json().catch(() => ({}))
    if (r.ok) setPingInfo(d.data)
  }, [caseId])
  useEffect(() => { if (canPing) loadPings() }, [canPing, loadPings])

  const ping = async () => {
    setBusy(true)
    const r = await api(`/api/admin/legal/${caseId}/ping`, { method: 'POST', body: JSON.stringify({ userId: pingUser || pingInfo?.people[0]?.userId }) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) toast.error(d.error || 'Ping failed'); else toast.success(d.message)
    load()
    loadPings()
  }

  if (err) return <div className="p-8 text-sm">{err} <Link className="underline" href="/admin/legal">Back</Link></div>
  if (!c) return <div className="p-8 flex justify-center"><Spinner className="w-6 h-6" /></div>

  const isOpener = me?.id === c.openedBy
  const canApprove = me?.canApprove && !isOpener
  const reopen = c.status === 'APPROVED' && !c.accessActive
  const done = c.status === 'CLOSED' || c.status === 'DENIED'

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl">
      <Link href="/admin/legal" className="text-sm inline-flex items-center gap-1 text-muted-foreground"><ArrowLeft className="w-4 h-4" />All cases</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{c.caseNumber}</h1>
        <Badge variant="outline">{c.type.replace('_', ' ')}</Badge>
        <Badge variant="outline">{c.status}</Badge>
        {c.accessActive && <Badge>Access open until {fmt(c.accessExpiresAt)}</Badge>}
        {c.nondisclosure && <Badge variant="destructive">Non-disclosure</Badge>}
      </div>

      <Card>
        <CardHeader><CardTitle>Request</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div><b>Agency:</b> {c.agency}</div>
          <div><b>Requester:</b> {c.requesterName}</div>
          <div><b>Contact:</b> {c.requesterContact}</div>
          <div><b>Their reference:</b> {c.referenceNumber || '-'}</div>
          <div className="sm:col-span-2"><b>Document:</b> {c.documentRef || '-'}</div>
          {c.emergencyReason && <div className="sm:col-span-2"><b>Emergency basis:</b> {c.emergencyReason}</div>}
          {c.summary && <div className="sm:col-span-2"><b>Summary:</b> {c.summary}</div>}
          <div><b>Scope:</b> {c.scopeUserId ? 'person ' + c.scopeUserId : ''} {c.scopeFamilyId ? 'family ' + c.scopeFamilyId : ''}</div>
          <div><b>Date range:</b> {fmt(c.scopeFrom)} to {fmt(c.scopeTo)}</div>
          <div><b>Live ping covered:</b> {c.includesLivePing ? 'yes' : 'no'}</div>
          <div><b>Opened by:</b> {c.openedByEmail || '-'} on {fmt(c.openedAt)}</div>
          {c.approvedAt && <div><b>{c.type === 'EMERGENCY' ? 'Started' : 'Approved by'}:</b> {c.approvedByEmail || 'emergency path'} on {fmt(c.approvedAt)}</div>}
          {c.counselReviewed && <div className="sm:col-span-2"><b>Counsel sign-off:</b> {c.counselNotes}</div>}
          {c.deniedReason && <div className="sm:col-span-2"><b>Denied:</b> {c.deniedReason}</div>}
          {c.preserveUntil && <div><b>Preservation hold until:</b> {fmt(c.preserveUntil)}</div>}
        </CardContent>
      </Card>

      {!done && (
        <Card>
          <CardHeader><CardTitle>Process</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {c.type === 'EMERGENCY' ? (
              <div className="text-sm space-y-2">
                <p>Emergency access is open now. A different Legal admin must review it within 72 hours.</p>
                {c.emergencyReviewStatus === 'PENDING' ? (
                  canApprove ? (
                    <div className="space-y-2">
                      <Textarea placeholder="Review notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                      <div className="flex gap-2">
                        <Button disabled={busy} onClick={() => act('emergency_review', { outcome: 'JUSTIFIED', notes })}>Mark justified</Button>
                        <Button variant="destructive" disabled={busy} onClick={() => act('emergency_review', { outcome: 'NOT_JUSTIFIED', notes })}>Not justified</Button>
                      </div>
                    </div>
                  ) : <p className="text-muted-foreground">Waiting for review by another approver{c.emergencyReviewOverdue ? ' (overdue)' : ''}.</p>
                ) : <p>Review: <b>{c.emergencyReviewStatus}</b>. {c.emergencyReviewNotes}</p>}
              </div>
            ) : c.status === 'OPEN' || reopen ? (
              <div className="space-y-3 text-sm">
                <div>
                  <b>1. Counsel sign-off</b> {c.counselReviewed ? '✓ recorded' : '(required before approval)'}
                  {!c.counselReviewed && (
                    <div className="mt-2 space-y-2">
                      <Textarea placeholder="Who at counsel reviewed this, when, and the outcome" value={notes} onChange={(e) => setNotes(e.target.value)} />
                      <Button disabled={busy} onClick={() => act('counsel', { notes })}>Record counsel sign-off</Button>
                    </div>
                  )}
                </div>
                <div>
                  <b>2. Approval by a different person</b>
                  {isOpener ? <p className="text-muted-foreground mt-1">You opened this case, so someone else must approve it.</p>
                    : !me?.canApprove ? <p className="text-muted-foreground mt-1">You don't have approval permission.</p>
                    : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span>Access for</span>
                        <Input className="w-20" type="number" min={1} max={168} value={hours} onChange={(e) => setHours(e.target.value)} />
                        <span>hours (max 168)</span>
                        <Button disabled={busy || !c.counselReviewed} onClick={() => act('approve', { hours: Number(hours) })}>Approve</Button>
                        <Button variant="outline" disabled={busy} onClick={() => { const r = window.prompt('Reason for denying'); if (r) act('deny', { reason: r }) }}>Deny</Button>
                      </div>
                    )}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { const d = window.prompt('Preserve this data for how many days? (0 clears)', '90'); if (d !== null) act('preserve', { days: Number(d) }) }}>Preservation hold</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act('close')}>Close case (ends access)</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {c.accessActive && (
        <Card>
          <CardHeader><CardTitle>Scoped data (read-only)</CardTitle><CardDescription>Only the covered people and date range. Every view is logged.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {SECTIONS.map(([k, l]) => <Button key={k} size="sm" variant={section === k && data ? 'default' : 'outline'} onClick={() => loadData(k)}>{l}</Button>)}
              <Button size="sm" variant="outline" disabled={busy} onClick={exportFile}><Download className="w-4 h-4 mr-1" />Export file</Button>
            </div>
            {dataLoading && <Spinner className="w-4 h-4" />}
            {data && !dataLoading && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{data.total ?? data.rows.length} record(s){data.rows.length >= 5000 ? ' (showing a page)' : ''}</p>
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-96">{JSON.stringify(data.rows.slice(0, 500), null, 2)}</pre>
                {data.rows.length >= 5000 && <Button size="sm" variant="outline" onClick={() => loadData(section, data.offset + 5000)}>Next page</Button>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canPing && (
        <Card>
          <CardHeader>
            <CardTitle>Live pings</CardTitle>
            <CardDescription>
              Asks the person&apos;s phone for a fresh location through the app&apos;s normal request channel. It only works while their
              location sharing is on; it never turns it on. At most one ping per person every 10 minutes. Everything here is logged.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={pingUser || pingInfo?.people[0]?.userId || ''}
                onChange={(e) => setPingUser(e.target.value)}
                aria-label="Person to ping"
              >
                {(pingInfo?.people || []).map((p) => (
                  <option key={p.userId} value={p.userId}>{p.name}{p.sharing ? '' : ' (sharing off)'}</option>
                ))}
              </select>
              <Button size="sm" disabled={busy || !pingInfo?.people.length} onClick={ping}><Send className="w-4 h-4 mr-1" />Send ping</Button>
              <Button size="sm" variant="outline" onClick={loadPings}>Refresh results</Button>
            </div>
            {pingInfo && pingInfo.pings.length === 0 && <p className="text-muted-foreground">No pings sent under this case yet.</p>}
            {pingInfo?.pings.map((p) => {
              const who = pingInfo.people.find((x) => x.userId === p.userId)?.name || p.userId
              return (
                <div key={p.id} className="rounded-md border p-2 space-y-0.5">
                  <div className="flex flex-wrap justify-between gap-2">
                    <b>{who}</b>
                    <span className="text-muted-foreground">sent {fmt(p.sentAt)} · {PING_STATUS[p.status] || p.status}</span>
                  </div>
                  {p.fix ? (
                    <div className="font-mono text-xs">
                      {p.fix.latitude.toFixed(6)}, {p.fix.longitude.toFixed(6)}
                      {p.fix.accuracy != null && <> · ±{Math.round(p.fix.accuracy)} m</>}
                      {p.fix.batteryLevel != null && <> · battery {p.fix.batteryLevel}%</>}
                      {' '}· fix taken {fmt(p.fix.at)}
                    </div>
                  ) : p.status === 'FULFILLED' ? (
                    <div className="text-xs text-muted-foreground">Answered {fmt(p.answeredAt)}, but no stored fix matched (it may have been merged into an earlier point).</div>
                  ) : null}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {!done && c.status !== 'OPEN' && !c.nondisclosure && !c.familyNotifiedAt && (
        <Card><CardContent className="py-4 flex items-center justify-between gap-3 text-sm">
          <span>Once the request has been handled, notify the family's parents that a legal request was received and answered.</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act('notify_family')}>Notify family</Button>
        </CardContent></Card>
      )}
      {c.familyNotifiedAt && <p className="text-sm text-muted-foreground">Family notified {fmt(c.familyNotifiedAt)}.</p>}

      <Card>
        <CardHeader><CardTitle>Exports</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {c.exports.length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {c.exports.map((x: any) => <div key={x.id} className="font-mono break-all">{fmt(x.createdAt)} · SHA-256 {x.sha256}</div>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Access log (append-only)</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {c.log.map((l: any) => (
            <div key={l.id} className="flex gap-2"><span className="text-muted-foreground whitespace-nowrap">{fmt(l.createdAt)}</span><span className="font-medium">{l.action}</span><span className="text-muted-foreground truncate">{l.admin || ''} {l.detail ? JSON.stringify(l.detail) : ''}</span></div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
