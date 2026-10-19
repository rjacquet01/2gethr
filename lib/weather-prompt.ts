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
