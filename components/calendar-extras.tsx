'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { format, isSameDay, parseISO } from 'date-fns'
import { Umbrella } from 'lucide-react'
import { authFetch } from '@/hooks/use-auth'
import { useMyRole } from '@/hooks/use-my-role'
import { cn } from '@/lib/utils'
import { weatherStatusFor, type WeatherStatus } from '@/lib/weather-prompt'

/* ------------------------------- Weather ------------------------------- */

export interface DayWeather {
  code: number
  hi: number
  lo: number
  rain: number
  wind: number
}

const jsonFetcher = async (url: string) => {
  const res = await authFetch(url)
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.success) throw new Error(j?.error || 'failed')
  return j.data
}

// Uses the family's "Home" saved place, else the first saved place. Guests
// can't read saved places (that would reveal the family's home), so they get
// no weather. weatherStatus tells a family with no saved place apart from
// loading / error / guest, so the calendar can explain the missing weather.
export function useCalendarWeatherState(familyId: string | undefined): {
  weather: Record<string, DayWeather>
  weatherStatus: WeatherStatus
  role: string | null
} {
  const { isGuest, role, isLoading: roleLoading } = useMyRole()
  const { data: places, error: placesError } = useSWR<any[]>(
    familyId && !isGuest ? `/api/places?familyId=${encodeURIComponent(familyId)}` : null,
    jsonFetcher
  )
  const list = (places || []).filter((p) => p.latitude != null && p.longitude != null)
  const spot = list.find((p) => /\b(home|house)\b/i.test(p.name || '')) || list[0]
  const lat = spot ? Number(spot.latitude) : null
  const lng = spot ? Number(spot.longitude) : null
  const { data, error: weatherError } = useSWR<Record<string, DayWeather>>(
    lat != null && lng != null ? `/api/weather?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}` : null,
    jsonFetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false }
  )
  const weatherStatus = weatherStatusFor({
    familyId,
    roleLoading,
    isGuest,
    placesLoaded: places !== undefined,
    placesError: !!placesError,
    hasPlace: !!spot,
    weatherLoaded: data !== undefined,
    weatherError: !!weatherError,
  })
  return { weather: data || {}, weatherStatus, role }
}

/** The forecast by yyyy-MM-dd ({} until there is one); unchanged for existing callers. */
export function useCalendarWeather(familyId: string | undefined): Record<string, DayWeather> {
  return useCalendarWeatherState(familyId).weather
}

export function weatherEmoji(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌦️'
  if (code === 85 || code === 86) return '❄️'
  if (code >= 95) return '⛈️'
  return '🌡️'
}

export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Mostly sunny'
  if (code === 3) return 'Cloudy'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  if (code === 85 || code === 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorms'
  return 'Weather'
}

export function CellWeather({ w }: { w?: DayWeather }) {
  if (!w) return null
  return (
    // Phones: its own line under the (centered) day number, which it used to
    // cover; wider screens: the top-right corner.
    <div className="flex items-center justify-center gap-0.5 text-[10px] leading-none text-muted-foreground sm:absolute sm:top-1 sm:right-1 sm:text-xs">
      <span aria-hidden>{weatherEmoji(w.code)}</span>
      <span className="font-medium">{w.hi}°</span>
      {w.rain >= 50 && <Umbrella className="h-3 w-3 text-sky-600" aria-label="Rain likely" />}
    </div>
  )
}

export function DayWeatherLine({ w }: { w?: DayWeather }) {
  if (!w) return null
  return (
    <p className="mb-3 -mt-2 text-sm text-muted-foreground">
      <span aria-hidden>{weatherEmoji(w.code)}</span> {weatherLabel(w.code)} · {w.hi}°/{w.lo}° ·{' '}
      <span className={cn(w.rain >= 50 && 'font-medium text-sky-700')}>{w.rain}% rain</span> · wind {w.wind} mph
    </p>
  )
}

/* -------------------------------- People ------------------------------- */

const PALETTE = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16']

function hashColor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function ParticipantDots({
  participants,
  members,
}: {
  participants?: Array<{ userId?: string | null; name?: string }>
  members?: Array<{ userId: string; color?: string | null; emoji?: string | null }>
}) {
  const list = (participants || []).filter((p) => p.name)
  if (list.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {list.slice(0, 6).map((p, i) => {
        const m = members?.find((x) => p.userId && String(x.userId) === String(p.userId))
        const color = m?.color || hashColor(p.name || '')
        return (
          <span
            key={i}
            title={p.name}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            {m?.emoji || (p.name || '?').trim().charAt(0).toUpperCase()}
          </span>
        )
      })}
      {list.length > 6 && <span className="text-xs text-muted-foreground">+{list.length - 6}</span>}
    </div>
  )
}

export function participantNames(events: Array<{ participants?: Array<{ name?: string }> }>): string[] {
  const set = new Set<string>()
  for (const e of events || []) for (const p of e.participants || []) if (p.name) set.add(p.name)
  return [...set].sort()
}

/* -------------------------------- Agenda ------------------------------- */

export function AgendaList({
  days,
  eventsFor,
  weather,
  members,
}: {
  days: Date[]
  eventsFor: (d: Date) => any[]
  weather: Record<string, DayWeather>
  members?: Array<{ userId: string; color?: string | null; emoji?: string | null }>
}) {
  const withEvents = days.filter((d) => eventsFor(d).length > 0)
  if (withEvents.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No events in this range.</p>
  }
  return (
    <div className="space-y-5">
      {withEvents.map((d) => {
        const w = weather[format(d, 'yyyy-MM-dd')]
        return (
          <section key={d.toISOString()}>
            <div className="mb-2 flex items-baseline justify-between border-b pb-1">
              <h3 className={cn('text-sm font-semibold', isSameDay(d, new Date()) && 'text-primary')}>
                {format(d, 'EEEE, MMM d')}
              </h3>
              {w && (
                <span className="text-xs text-muted-foreground">
                  {weatherEmoji(w.code)} {w.hi}°/{w.lo}°{w.rain >= 50 ? ` · ${w.rain}% rain` : ''}
                </span>
              )}
            </div>
            <ul className="space-y-2">
              {eventsFor(d).map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/calendar/event/${e.id}`}
                    className="block rounded-lg border p-3 hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate font-medium">{e.title}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {e.allDay || e.isAllDay ? 'All day' : format(parseISO(e.startTime), 'h:mm a')}
                      </span>
                    </div>
                    {e.location && <p className="truncate text-xs text-muted-foreground">{e.location}</p>}
                    <ParticipantDots participants={e.participants} members={members} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
