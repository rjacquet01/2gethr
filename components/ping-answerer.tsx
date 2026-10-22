'use client'

import { useEffect } from 'react'
import { authFetch } from '@/hooks/use-auth'
import { getPositionWithFallback } from '@/lib/geo-position'

const CHECK_MS = 30_000

// A parent can ping their child's location with no approval, even while the
// child's sharing is off. While the app is open and visible, this answers
// such pings with one fix, stored as a snapshot only the parent sees. Pings
// in a family where this person is sharing are answered by the location
// page's live tracking instead ("live").
export function PingAnswerer() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    let busy = false
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      try {
        const r = await authFetch('/api/location/request')
        if (!r.ok) return
        const j = await r.json()
        const open = (Array.isArray(j?.data) ? j.data : []).filter((q: { answerWith?: string }) => q.answerWith === 'snapshot')
        if (open.length === 0) return
        const pos = await new Promise<GeolocationPosition | null>((resolve) =>
          getPositionWithFallback(resolve, () => resolve(null))
        )
        if (!pos) return
        await Promise.all(open.map((q: { id: string }) =>
          authFetch(`/api/location/request/${encodeURIComponent(q.id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'answer',
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
            }),
          }).catch(() => {})
        ))
      } catch {
        // try again on the next check
      } finally {
        busy = false
      }
    }
    check()
    const timer = setInterval(check, CHECK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
