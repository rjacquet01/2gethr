'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { format, isSameDay, parseISO } from 'date-fns'
import { Umbrella } from 'lucide-react'
import { authFetch } from '@/hooks/use-auth'
import { MemberAvatar } from '@/components/member-avatar'
import { useMyRole } from '@/hooks/use-my-role'
import { cn } from '@/lib/utils'
import { chooseWeatherPlace, weatherPlaceLabel, weatherStatusFor, type WeatherStatus } from '@/lib/weather-prompt'

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

// Uses the family's "Home" saved place, else the first saved place
// (lib/weather-prompt chooseWeatherPlace), and says which one. Guests
// can't read saved places (that would reveal the family's home), so they get
// no weather. weatherStatus tells a family with no saved place apart from
// loading / error / guest, so the calendar can explain the missing weather.
export function useCalendarWeatherState(familyId: string | undefined): {
  weather: Record<string, DayWeather>
  weatherStatus: WeatherStatus
  role: string | null
  /** "Weather for Home · Andover, MA" (null for guests or with no place). */
  placeLabel: string | null
  /** False when the weather fell back to a place not named Home/House. */
  isHomePlace: boolean
  /** Which provider answered ("open-meteo" | "nws"), for the attribution. */
  source: string | null
} {
  const { isGuest, role, isLoading: roleLoading } = useMyRole()
  const { data: places, error: placesError } = useSWR<any[]>(
    familyId && !isGuest ? `/api/places?familyId=${encodeURIComponent(familyId)}` : null,
    jsonFetcher
  )
  const chosen = chooseWeatherPlace(places, { isGuest })
  const spot = chosen?.place
  const lat = spot ? Number(spot.latitude) : null
  const lng = spot ? Number(spot.longitude) : null
  const { data: forecast, error: weatherError } = useSWR<{ days: Record<string, DayWeather>; source: string | null }>(
    lat != null && lng != null ? `/api/weather?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}` : null,
    weatherFetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false }
  )
  const data = forecast?.days
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
  return {
    weather: data || {},
    weatherStatus,
    role,
    placeLabel: weatherPlaceLabel(chosen),
    isHomePlace: !!chosen?.isHome,
    source: forecast?.source ?? null,
  }
}

const weatherFetcher = async (url: string) => {
  const res = await authFetch(url)
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.success) throw new Error(j?.error || 'failed')
  return { days: j.data as Record<string, DayWeather>, source: (j.source as string | undefined) ?? null }
}

/** "Weather for Home · Andover, MA", plus a hint when it fell back to another place. */
export function WeatherPlaceLine({
  label,
  isHomePlace,
  source,
  canManagePlaces,
}: {
  label: string | null
  isHomePlace: boolean
  source: string | null
  canManagePlaces: boolean
}) {
  if (!label) return null
  return (
    <p className="text-xs text-muted-foreground" title={source ? `Forecast: ${source === 'nws' ? 'NWS' : 'Open-Meteo'}` : undefined}>
      {label}
      {!isHomePlace && (
        <>
          {' · '}
          {canManagePlaces ? (
            <Link href="/places" className="underline underline-offset-2 hover:text-foreground">Name a place &quot;Home&quot;</Link>
          ) : (
            'Name a place "Home"'
          )}{' '}
          to use it for weather
        </>
      )}
    </p>
  )
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

/** How a family member or child looks: their photo, else emoji, else initials, in their color. */
export interface ParticipantLook {
  userId?: string | null
  /** Children without a login are event participants by child profile. */
  childProfileId?: string | null
  avatarUrl?: string | null
  color?: string | null
  emoji?: string | null
}

/**
 * Looks for everyone in a family (from useFamily: members and children). A
 * child's own profile photo wins over their login's, as on the Family page.
 */
export function participantLooks(family?: {
  members?: Array<{ id: string; userId: string; avatarUrl: string | null; color?: string | null; emoji?: string | null }>
  children?: Array<{ id: string; familyMemberId?: string; avatarUrl: string | null; color?: string | null; emoji?: string | null }>
} | null): ParticipantLook[] {
  if (!family) return []
  const members = family.members || []
  const looks: ParticipantLook[] = (family.children || []).map((c) => {
    const login = members.find((m) => m.id === c.familyMemberId)
    return {
      childProfileId: c.id,
      userId: login?.userId ?? null,
      avatarUrl: c.avatarUrl || login?.avatarUrl || null,
      color: c.color || login?.color || null,
      emoji: c.emoji || login?.emoji || null,
    }
  })
  for (const m of members) {
    if (looks.some((l) => l.userId && l.userId === m.userId)) continue
    looks.push({ userId: m.userId, avatarUrl: m.avatarUrl, color: m.color, emoji: m.emoji })
  }
  return looks
}

type Participant = { userId?: string | null; childProfileId?: string | null; name?: string }

function lookFor(p: Participant, members?: ParticipantLook[]) {
  return members?.find((x) =>
    (p.userId && x.userId && String(x.userId) === String(p.userId)) ||
    (p.childProfileId && x.childProfileId && String(x.childProfileId) === String(p.childProfileId)))
}

function ParticipantAvatar({ p, members, className }: { p: Participant; members?: ParticipantLook[]; className?: string }) {
  const m = lookFor(p, members)
  return (
    <MemberAvatar
      name={p.name}
      avatarUrl={m?.avatarUrl}
      color={m?.color || hashColor(p.name || '')}
      emoji={m?.emoji}
      className={className}
    />
  )
}

/** Everyone in these participant lists once (by user, child profile, else name), in order. */
export function uniqueParticipants(lists: Array<Participant[] | undefined>): Participant[] {
  const seen = new Set<string>()
  const out: Participant[] = []
  for (const list of lists) {
    for (const p of list || []) {
      if (!p.name) continue
      const key = p.userId ? `u:${p.userId}` : p.childProfileId ? `c:${p.childProfileId}` : `n:${p.name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

/**
 * A compact, overlapping row of faces for tight spots (the week grid). Each
 * face has a white ring so it stays readable on a colored event chip.
 */
export function ParticipantFaces({
  participants,
  members,
  max = 3,
  className,
}: {
  participants?: Participant[]
  members?: ParticipantLook[]
  max?: number
  /** Size of each face (default h-4 w-4). */
  className?: string
}) {
  const list = (participants || []).filter((p) => p.name)
  if (list.length === 0) return null
  return (
    <span className="inline-flex shrink-0 items-center -space-x-1" title={list.map((p) => p.name).join(', ')}>
      {list.slice(0, max).map((p, i) => (
        <ParticipantAvatar
          key={i}
          p={p}
          members={members}
          className={cn('h-4 w-4 text-[8px] ring-1 ring-background', className)}
        />
      ))}
      {list.length > max && <span className="pl-1.5 text-[10px] font-medium opacity-80">+{list.length - max}</span>}
    </span>
  )
}

export function ParticipantDots({
  participants,
  members,
  className,
}: {
  participants?: Participant[]
  members?: ParticipantLook[]
  /** Size of each avatar (default h-5 w-5). */
  className?: string
}) {
  const list = (participants || []).filter((p) => p.name)
  if (list.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {list.slice(0, 6).map((p, i) => (
        <span key={i} title={p.name} className="inline-flex">
          <ParticipantAvatar p={p} members={members} className={cn('h-5 w-5 text-[10px]', className)} />
        </span>
      ))}
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
  colorClass,
  colorStyle,
}: {
  days: Date[]
  eventsFor: (d: Date) => any[]
  weather: Record<string, DayWeather>
  members?: ParticipantLook[]
  /** The event's color, as in month view: a category class, or a custom color style. */
  colorClass?: (e: { category: string; customColor?: string | null }) => string
  colorStyle?: (e: { customColor?: string | null }) => React.CSSProperties | undefined
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
                    className="flex gap-3 rounded-lg border p-3 hover:bg-muted/50"
                  >
                    <span
                      className={cn('w-1 shrink-0 self-stretch rounded-full bg-muted', colorClass?.(e))}
                      style={colorStyle?.(e)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate font-medium">{e.title}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {e.allDay || e.isAllDay ? 'All day' : format(parseISO(e.startTime), 'h:mm a')}
                        </span>
                      </div>
                      {e.location && <p className="truncate text-xs text-muted-foreground">{e.location}</p>}
                      <ParticipantDots participants={e.participants} members={members} className="h-7 w-7 text-sm" />
                    </div>
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
