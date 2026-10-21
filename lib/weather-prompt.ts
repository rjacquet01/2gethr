// Calendar weather status and the "add a Home place" prompt. Plain functions
// (no React) so scripts/test-weather-prompt.ts can check them directly.

export type WeatherStatus = 'loading' | 'ready' | 'no-place' | 'guest' | 'error'

/** Same roles the places API treats as place managers. */
export const PLACE_MANAGER_ROLES = ['PARENT', 'GUARDIAN', 'ADULT', 'ADMIN']

export function weatherStatusFor(s: {
  familyId: string | null | undefined
  roleLoading: boolean
  isGuest: boolean
  placesLoaded: boolean
  placesError: boolean
  hasPlace: boolean
  weatherLoaded: boolean
  weatherError: boolean
}): WeatherStatus {
  if (!s.familyId || s.roleLoading) return 'loading'
  if (s.isGuest) return 'guest'
  if (s.placesError) return 'error'
  if (!s.placesLoaded) return 'loading'
  if (!s.hasPlace) return 'no-place'
  if (s.weatherError) return 'error'
  if (!s.weatherLoaded) return 'loading'
  return 'ready'
}

/** 'add' (link to places), 'ask' (ask a parent) or null (show nothing). */
export function weatherPromptFor(status: WeatherStatus, role: string | null | undefined): 'add' | 'ask' | null {
  if (status !== 'no-place' || !role || role === 'GUEST') return null
  return PLACE_MANAGER_ROLES.includes(role) ? 'add' : 'ask'
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>

const dismissKey = (familyId: string) => `togethr:weather-prompt-dismissed:${familyId}`

function browserStorage(): KeyStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Whether this family's prompt was dismissed; false if storage is unavailable. */
export function isWeatherPromptDismissed(familyId: string, store: KeyStore | null = browserStorage()): boolean {
  try {
    return store?.getItem(dismissKey(familyId)) === '1'
  } catch {
    return false
  }
}

/** Remember the dismissal; silently does nothing if storage is unavailable. */
export function dismissWeatherPrompt(familyId: string, store: KeyStore | null = browserStorage()): void {
  try {
    store?.setItem(dismissKey(familyId), '1')
  } catch {
    // Private mode / blocked storage: the banner just comes back next visit.
  }
}

/* ------------------------------ Weather place ------------------------------ */

export interface WeatherPlaceInput {
  name?: string | null
  address?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
}

export interface WeatherPlace<P extends WeatherPlaceInput = WeatherPlaceInput> {
  place: P
  /** The family's "Home"/"House" place, not a fallback. */
  isHome: boolean
}

const HOME = /\b(home|house)\b/i

/**
 * The place the calendar weather is for: "Home"/"House", else the first with
 * coordinates. Never for a guest (that would reveal where the family lives).
 */
export function chooseWeatherPlace<P extends WeatherPlaceInput>(
  places: P[] | null | undefined,
  opts: { isGuest?: boolean } = {}
): WeatherPlace<P> | null {
  if (opts.isGuest) return null
  const list = (places || []).filter((p) => p.latitude != null && p.longitude != null)
  const home = list.find((p) => HOME.test(p.name || ''))
  if (home) return { place: home, isHome: true }
  return list[0] ? { place: list[0], isHome: false } : null
}

/**
 * "Andover, MA" from a free-text address, only when it clearly ends with
 * "City, ST" or "City, ST 01810" (optionally then the country). Anything
 * else gives null, so a street or partial address is never shown.
 */
export function localityFromAddress(address: string | null | undefined): string | null {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length > 0 && /^(usa|us|united states( of america)?)$/i.test(parts[parts.length - 1])) parts.pop()
  if (parts.length < 2) return null
  const m = /^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(parts[parts.length - 1])
  const city = parts[parts.length - 2]
  if (!m || !city || /\d/.test(city) || city.length > 40) return null
  return `${city}, ${m[1]}`
}

/** "Weather for Home · Andover, MA": the place name and, when clear, its city/state. Never the street or coordinates. */
export function weatherPlaceLabel(chosen: WeatherPlace | null): string | null {
  if (!chosen) return null
  const name = String(chosen.place.name || '').trim() || 'your saved place'
  const locality = localityFromAddress(chosen.place.address)
  return `Weather for ${name}${locality && locality.toLowerCase() !== name.toLowerCase() ? ` · ${locality}` : ''}`
}
