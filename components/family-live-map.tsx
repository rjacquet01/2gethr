'use client'

import { useEffect, useRef, useState } from 'react'
import { authFetch } from '@/hooks/use-auth'
import { MapPin } from 'lucide-react'

// Leaflet is loaded from a CDN at runtime (pinned version) so the app needs
// no new npm dependency. Tiles are OpenStreetMap, which needs no API key.
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'

/* eslint-disable @typescript-eslint/no-explicit-any */
let leafletPromise: Promise<any> | null = null
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  const w = window as any
  if (w.L) return Promise.resolve(w.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = LEAFLET_CSS
      document.head.appendChild(link)
    }
    const script = document.createElement('script')
    script.src = LEAFLET_JS
    script.async = true
    script.onload = () => resolve(w.L)
    script.onerror = () => {
      leafletPromise = null
      reject(new Error('Could not load the map'))
    }
    document.head.appendChild(script)
  })
  return leafletPromise
}

export interface LiveMapMember {
  memberId: string
  name: string
  color?: string | null
  emoji?: string | null
  location: {
    latitude: number
    longitude: number
    accuracy?: number | null
    timestamp: string
    batteryLevel?: number | null
  } | null
}

export interface TrailPoint {
  latitude: number
  longitude: number
  timestamp: string
}

interface Props {
  members: LiveMapMember[]
  familyId?: string
  /** Member to centre on; when absent the map fits everyone. */
  focusMemberId?: string | null
  trail?: TrailPoint[]
  className?: string
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

function ago(ts: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`
  return `${Math.floor(mins / 1440)} d ago`
}

export function FamilyLiveMap({ members, familyId, focusMemberId, trail, className }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)
  const fittedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [places, setPlaces] = useState<{ name: string; latitude: number; longitude: number; radius: number }[]>([])

  useEffect(() => {
    if (!familyId) return
    let cancelled = false
    authFetch(`/api/places?familyId=${familyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return
        setPlaces(
          j.data
            .filter((p: any) => p.geofenceEnabled && p.latitude != null && p.longitude != null)
            .map((p: any) => ({ name: p.name, latitude: Number(p.latitude), longitude: Number(p.longitude), radius: Number(p.radius) || 100 }))
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [familyId])

  useEffect(() => {
    let disposed = false
    loadLeaflet()
      .then((L) => {
        if (disposed || !el.current || mapRef.current) return
        const map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4)
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map)
        mapRef.current = map
        layerRef.current = L.layerGroup().addTo(map)
        setReady(true)
      })
      .catch((e) => setError(e.message || 'Could not load the map'))
    return () => {
      disposed = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        layerRef.current = null
        fittedRef.current = false
      }
    }
  }, [])

  useEffect(() => {
    const L = (window as any).L
    const map = mapRef.current
    const layer = layerRef.current
    if (!ready || !L || !map || !layer) return
    layer.clearLayers()
    const bounds: [number, number][] = []

    for (const p of places) {
      L.circle([p.latitude, p.longitude], { radius: p.radius, color: '#3b82f6', weight: 1, fillOpacity: 0.08 })
        .bindTooltip(esc(p.name))
        .addTo(layer)
    }

    if (trail && trail.length > 1) {
      const pts = trail.map((t) => [t.latitude, t.longitude] as [number, number])
      L.polyline(pts, { color: '#f97316', weight: 4, opacity: 0.8 }).addTo(layer)
      L.circleMarker(pts[0], { radius: 5, color: '#16a34a', fillOpacity: 1 }).bindTooltip('Start').addTo(layer)
      pts.forEach((pt) => bounds.push(pt))
    }

    for (const m of members) {
      if (!m.location) continue
      const { latitude, longitude, accuracy, timestamp, batteryLevel } = m.location
      const initial = esc((m.name || '?').trim().charAt(0).toUpperCase())
      const stale = Date.now() - new Date(timestamp).getTime() > 30 * 60 * 1000
      const icon = L.divIcon({
        className: '',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        html: `<div style="width:40px;height:40px;border-radius:50%;background:${esc(m.color || '#3b82f6')};border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${m.emoji ? 20 : 16}px;opacity:${stale ? 0.65 : 1}">${m.emoji ? esc(m.emoji) : initial}</div>`,
      })
      if (accuracy && accuracy > 15 && accuracy < 2000) {
        L.circle([latitude, longitude], { radius: accuracy, color: m.color || '#3b82f6', weight: 1, fillOpacity: 0.08 }).addTo(layer)
      }
      L.marker([latitude, longitude], { icon })
        .bindPopup(
          `<strong>${esc(m.name)}</strong><br/>${ago(timestamp)}${batteryLevel != null ? `<br/>Battery ${batteryLevel}%` : ''}`
        )
        .addTo(layer)
      if (!focusMemberId || focusMemberId === m.memberId) bounds.push([latitude, longitude])
    }

    if (bounds.length === 0) return
    if (focusMemberId || !fittedRef.current) {
      if (bounds.length === 1) map.setView(bounds[0], 16)
      else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 })
      fittedRef.current = true
    }
  }, [ready, members, places, trail, focusMemberId])

  return (
    <div className={`relative w-full overflow-hidden rounded-lg bg-muted ${className || 'h-[420px]'}`}>
      <div ref={el} className="absolute inset-0 z-0" />
      {!ready && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">Loading map…</div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-muted text-sm text-muted-foreground">
          <MapPin className="h-8 w-8" />
          {error}
        </div>
      )}
    </div>
  )
}
