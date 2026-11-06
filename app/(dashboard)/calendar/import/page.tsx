'use client'

import { Suspense, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { mutate } from 'swr'
import { ArrowLeft, Camera, Check, ImageIcon, AlertTriangle, Loader2, Repeat, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { TimeSelect } from '@/components/ui/time-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UpgradeGate } from '@/components/upgrade-gate'
import { loadWorkCanvas } from '@/components/board/flyer-editor'
import { refreshPlanUsage } from '@/components/plan-limit-notice'
import { authFetch } from '@/hooks/use-auth'
import { useFamily } from '@/hooks/use-family'
import { useMyRole } from '@/hooks/use-my-role'
import { useSmartImport } from '@/hooks/use-smart-import'
import type { ImportConfidence, ImportedEvent } from '@/lib/smart-import'
import { findDuplicate, reviewEventTimes } from '@/lib/smart-import-review'

// Smart Import review: read a flyer (from the board or a new photo) or pasted
// text into suggested events, let the person fix and pick them, then add the
// picked ones one by one through POST /api/events. Nothing is saved until
// "Add N events" is tapped.

interface Row extends ImportedEvent {
  key: number
  selected: boolean
  result?: { ok: true } | { ok: false; error: string }
}

interface Who {
  type: 'member' | 'child'
  id: string
  userId?: string
  childProfileId?: string
  name: string
}

const CONFIDENCE: Record<ImportConfidence, { label: string; className: string }> = {
  high: { label: 'Clear', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  med: { label: 'Check this', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  low: { label: 'Unsure', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
}

// Phone cameras make 4-12 MB photos, over what one request can carry. Shrink to
// 2000 px JPEG in the browser first; anything that can't be decoded goes as is.
async function shrinkPhoto(file: File, maxPx = 2000): Promise<File> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 3_000_000) { bmp.close?.(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
export default function ImportEventsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <ImportEvents />
    </Suspense>
  )
}

/** Shrink a picked photo to the board's upload size, as a JPEG. */
async function photoToJpeg(file: File): Promise<Blob> {
  const canvas = await loadWorkCanvas(file)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85))
}

function ImportEvents() {
  const router = useRouter()
  const params = useSearchParams()
  const role = useMyRole()
  const familyId = params.get('familyId') || role.familyId
  const postId = params.get('postId')
  const { status, isLoading, refresh } = useSmartImport(familyId)
  const { family } = useFamily(familyId || undefined)

  const [photo, setPhoto] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<{ message: string; overCap?: boolean } | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [existing, setExisting] = useState<{ title: string; startTime: string }[]>([])
  const [who, setWho] = useState<Who[]>([])
  const [adding, setAdding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    setText('')
    setPhoto(picked ? await shrinkPhoto(picked) : null)
  }

  const people: Who[] = useMemo(() => {
    if (!family) return []
    const members = (family.members || []).map((m) => ({ type: 'member' as const, id: m.id, userId: m.userId, name: m.displayName }))
    const kids = (family.children || [])
      .filter((c) => !(c.hasAccount ?? c.hasLogin))
      .map((c) => ({ type: 'child' as const, id: c.id, childProfileId: c.id, name: c.displayName }))
    return [...members, ...kids]
  }, [family])

  if (role.isLoading || isLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }
  // status is null while the flag is off and for children and guests (the route answers 403).
  if (!familyId || !status) {
    return (
      <div className="container max-w-2xl py-6">
        <Empty title="Import isn't available" description="You can add the event yourself." />
        <div className="mt-4 text-center"><Button asChild><Link href="/calendar/new">New event</Link></Button></div>
      </div>
    )
  }

  const overCap = status.used >= status.limit || error?.overCap === true

  const find = async () => {
    setError(null)
    setReading(true)
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      let res: Response
      if (postId) {
        res = await authFetch('/api/import/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyId, postId, timeZone }) })
      } else if (photo) {
        const form = new FormData()
        form.append('familyId', familyId)
        form.append('timeZone', timeZone)
        form.append('file', new File([await photoToJpeg(photo)], 'import.jpg', { type: 'image/jpeg' }))
        res = await authFetch('/api/import/events', { method: 'POST', body: form })
      } else {
        res = await authFetch('/api/import/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyId, text, timeZone }) })
      }
      const json = await res.json().catch(() => ({}))
      refresh()
      if (!res.ok) {
        setError({ message: json.error || "Import isn't available right now. Try again in a minute.", overCap: res.status === 402 })
        return
      }
      const events = (json.data?.events || []) as ImportedEvent[]
      if (events.length === 0) {
        setError({ message: json.data?.message || "We couldn't find any dates in this. You can add the event yourself." })
        return
      }
      setRows(events.map((e, i) => ({ ...e, key: i, selected: e.confidence !== 'low' })))
      loadExisting(events)
    } catch {
      setError({ message: "Import isn't available right now. Try again in a minute." })
    } finally {
      setReading(false)
    }
  }

  // Events already in the family's calendar over the found dates, for the duplicate warning.
  const loadExisting = async (events: ImportedEvent[]) => {
    const dates = events.map((e) => e.date).sort()
    const from = reviewEventTimes({ ...events[0], date: dates[0], allDay: true }).startTime
    const to = reviewEventTimes({ ...events[0], date: dates[dates.length - 1], allDay: true }).endTime
    try {
      const res = await authFetch(`/api/events?familyId=${familyId}&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`)
      const json = await res.json().catch(() => null)
      if (res.ok && Array.isArray(json?.data)) setExisting(json.data)
    } catch {
      // The warning is a nicety; adding still works without it.
    }
  }

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...patch, result: undefined } : r)) ?? null)

  const picked = rows?.filter((r) => r.selected && r.result?.ok !== true) ?? []

  const addPicked = async () => {
    if (!rows) return
    for (const r of picked) {
      if (!r.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        toast.error('Each event needs a title and a date')
        return
      }
    }
    setAdding(true)
    let ok = 0
    for (const r of picked) {
      const times = reviewEventTimes(r)
      let result: Row['result']
      try {
        const res = await authFetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            familyId,
            title: r.title.trim(),
            description: r.notes?.trim() || null,
            location: r.location?.trim() || null,
            ...times,
            allDay: r.allDay,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            participants: who.map((p) => ({ userId: p.userId, childProfileId: p.childProfileId })),
          }),
        })
        const json = await res.json().catch(() => ({}))
        result = res.ok ? { ok: true } : { ok: false, error: json.error || 'Could not add this one' }
      } catch {
        result = { ok: false, error: 'Could not add this one' }
      }
      if (result.ok) ok++
      setRows((prev) => prev?.map((x) => (x.key === r.key ? { ...x, result } : x)) ?? null)
    }
    setAdding(false)
    refreshPlanUsage(familyId)
    await mutate((key) => typeof key === 'string' && key.startsWith('/api/events'), undefined, { revalidate: true })
    if (ok === picked.length) {
      toast.success(ok === 1 ? 'Event added' : `${ok} events added`)
      router.push('/calendar')
    } else if (ok > 0) {
      toast.message(`${ok} of ${picked.length} added. Check the ones marked below.`)
    }
  }

  const toggleWho = (p: Who) =>
    setWho((prev) => (prev.some((x) => x.type === p.type && x.id === p.id) ? prev.filter((x) => !(x.type === p.type && x.id === p.id)) : [...prev, p]))

  return (
    <div className="container max-w-2xl py-6">
      <Button variant="ghost" className="mb-4" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Import events</CardTitle>
          <CardDescription>
            {rows
              ? 'Check each event, fix anything that is off, and untick what you don’t want. Nothing is added until you tap Add.'
              : postId
                ? 'We’ll read the flyer from the board and suggest events for you to check.'
                : 'Pick a photo of a flyer or paste some text. We’ll suggest events for you to check.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!rows && (
            <>
              {!postId && (
                <>
                  <div className="space-y-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={onPick}
                    />
                    <input
                      ref={cameraRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={onPick}
                    />
                    {photo ? (
                      <p className="truncate rounded-md border px-3 py-2 text-sm">{photo.name}</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()}>
                          <Camera className="mr-2 h-4 w-4" /> Take a photo
                        </Button>
                        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                          <ImageIcon className="mr-2 h-4 w-4" /> Choose a photo
                        </Button>
                      </div>
                    )}
                    {!photo && <p className="text-xs text-muted-foreground">Fill the frame and hold steady so the dates are sharp.</p>}
                    {photo && (
                      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ''; if (cameraRef.current) cameraRef.current.value = '' }}>
                        Remove photo
                      </button>
                    )}
                  </div>
                  {!photo && (
                    <div className="space-y-2">
                      <Label htmlFor="import-text">Or paste text</Label>
                      <Textarea
                        id="import-text"
                        rows={6}
                        maxLength={8000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Paste a school email, a text message or a schedule"
                      />
                    </div>
                  )}
                </>
              )}

              {error && !error.overCap && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <p>{error.message}</p>
                  {(
                    <Link href="/calendar/new" className="mt-2 inline-block font-medium underline">Add an event yourself</Link>
                  )}
                </div>
              )}

              <Button className="w-full" onClick={find} disabled={reading || (!postId && !photo && !text.trim()) || overCap}>
                {reading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading…</> : 'Find events'}
              </Button>
              {overCap ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <p>You&apos;ve used your imports this month ({status.used} of {status.limit}).</p>
                  {status.upgradeTo && (
                    <div className="mt-2">
                      <UpgradeGate>
                        <Link href="/subscription/upgrade" className="font-medium underline">
                          {status.upgradeTo.name} includes {status.upgradeTo.limit} imports a month
                        </Link>
                      </UpgradeGate>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground">{status.used} of {status.limit} imports used this month.</p>
              )}
              <p className="text-center text-xs text-muted-foreground">
                Only the photo or text you choose is sent to our AI provider to read the dates. <Link href="/privacy" className="underline">Privacy</Link>
              </p>
            </>
          )}

          {rows && (
            <>
              {rows.map((r) => {
                const dup = findDuplicate(r, existing)
                return (
                  <div key={r.key} className={`space-y-3 rounded-lg border p-3 ${r.selected ? '' : 'opacity-60'}`}>
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={r.selected}
                        onCheckedChange={(v) => update(r.key, { selected: v === true })}
                        aria-label={`Add ${r.title}`}
                        className="mt-2.5"
                        disabled={r.result?.ok === true}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <Input value={r.title} maxLength={200} onChange={(e) => update(r.key, { title: e.target.value })} aria-label="Title" />
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${CONFIDENCE[r.confidence].className}`}>
                          {CONFIDENCE[r.confidence].label}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Date</Label>
                        <Input type="date" value={r.date} onChange={(e) => update(r.key, { date: e.target.value })} />
                      </div>
                      <div className="flex items-center gap-2 sm:pt-6">
                        <Switch
                          id={`allday-${r.key}`}
                          checked={r.allDay}
                          onCheckedChange={(v) => update(r.key, v ? { allDay: true } : { allDay: false, startTime: r.startTime || '09:00' })}
                        />
                        <Label htmlFor={`allday-${r.key}`} className="text-sm">All day</Label>
                      </div>
                      {!r.allDay && (
                        <>
                          <div className="space-y-1">
                            <Label className="text-xs">Starts</Label>
                            <TimeSelect value={r.startTime || '09:00'} onChange={(v) => update(r.key, { startTime: v })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Ends</Label>
                            <TimeSelect value={r.endTime || ''} onChange={(v) => update(r.key, { endTime: v })} />
                          </div>
                        </>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Location</Label>
                      <Input value={r.location || ''} maxLength={500} onChange={(e) => update(r.key, { location: e.target.value })} placeholder="Optional" />
                    </div>

                    {r.notes && <p className="text-xs text-muted-foreground">Notes: {r.notes}</p>}
                    {r.recurrence && (
                      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Repeats ({r.recurrence}). Only this first date is added; you can set it to repeat afterwards.
                      </p>
                    )}
                    {r.sourceText && <p className="border-l-2 pl-2 text-xs italic text-muted-foreground">&ldquo;{r.sourceText}&rdquo;</p>}
                    {dup && r.result?.ok !== true && (
                      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Already on the calendar: &ldquo;{dup.title}&rdquo; at the same time.
                      </p>
                    )}
                    {r.result && (
                      <p className={`flex items-center gap-1.5 text-xs ${r.result.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
                        {r.result.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                        {r.result.ok ? 'Added' : r.result.error}
                      </p>
                    )}
                  </div>
                )
              })}

              {people.length > 0 && (
                <div className="space-y-2">
                  <Label>Who it&apos;s for</Label>
                  <div className="flex flex-wrap gap-2">
                    {people.map((p) => {
                      const on = who.some((x) => x.type === p.type && x.id === p.id)
                      return (
                        <button key={`${p.type}-${p.id}`} type="button" onClick={() => toggleWho(p)}>
                          <Badge variant={on ? 'default' : 'outline'} className="px-3 py-1 text-sm">
                            {on && <Check className="mr-1 h-3 w-3" />}
                            {p.name}
                          </Badge>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="flex-1" onClick={addPicked} disabled={adding || picked.length === 0}>
                  {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {picked.length === 1 ? 'Add 1 event' : `Add ${picked.length} events`}
                </Button>
                <Button variant="outline" onClick={() => router.push('/calendar')} disabled={adding}>Done</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
