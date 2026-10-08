'use client'

import { useEffect, useState } from 'react'
import { authFetch } from '@/hooks/use-auth'
import { FamilyLiveMap, type LiveMapMember, type TrailPoint } from '@/components/family-live-map'
import { Button } from '@/components/ui/button'

interface Props {
  members: LiveMapMember[]
  familyId?: string
  focusMemberId?: string | null
  /** Show the "route history" controls (needs a focused member). */
  allowTrail?: boolean
  className?: string
}

const RANGES = [
  { label: 'Off', hours: 0 },
  { label: '6 h', hours: 6 },
  { label: '24 h', hours: 24 },
  { label: '3 days', hours: 72 },
]

/** Live family map plus an optional where-have-they-been route for one member. */
export function TrackedMap({ members, familyId, focusMemberId, allowTrail = true, className }: Props) {
  const [hours, setHours] = useState(0)
  const [trail, setTrail] = useState<TrailPoint[] | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    setTrail(undefined)
    setNote(null)
    if (!hours || !focusMemberId || !familyId) return
    let cancelled = false
    setLoading(true)
    authFetch(`/api/location/history?memberId=${focusMemberId}&familyId=${familyId}&hours=${hours}`)
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => null) }))
      .then(({ ok, j }) => {
        if (cancelled) return
        if (!ok || !j?.success) {
          setNote(j?.error || 'Could not load route history')
          return
        }
        const pts: TrailPoint[] = j.data.points
        setTrail(pts)
        if (pts.length < 2) setNote('Not enough movement recorded in that time.')
      })
      .catch(() => !cancelled && setNote('Could not load route history'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [hours, focusMemberId, familyId])

  return (
    <div className="space-y-2">
      {allowTrail && focusMemberId && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Route history:</span>
          {RANGES.map((r) => (
            <Button
              key={r.hours}
              type="button"
              size="sm"
              variant={hours === r.hours ? 'default' : 'outline'}
              className="h-7 px-2"
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </Button>
          ))}
          {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
        </div>
      )}
      <FamilyLiveMap members={members} familyId={familyId} focusMemberId={focusMemberId} trail={trail} className={className} />
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
