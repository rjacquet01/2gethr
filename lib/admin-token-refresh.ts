/**
 * Keeps the admin access token (15 minutes) fresh in the browser. Admin pages
 * read the token from localStorage synchronously, so without this every
 * action taken more than 15 minutes after sign-in failed with "Unauthorized".
 *
 * Refresh tokens rotate on every use (lib/admin-auth.ts refreshAdminTokens),
 * so one refresh runs at a time: in this tab through a shared promise, across
 * tabs through the Web Locks API when the browser has it.
 */

export const ADMIN_ACCESS_TOKEN_KEY = 'safelink_admin_access_token'
export const ADMIN_REFRESH_TOKEN_KEY = 'safelink_admin_refresh_token'

/** Refresh when the access token has less than this left. */
export const ADMIN_REFRESH_MARGIN_MS = 3 * 60 * 1000

export interface AdminTokenEnv {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  fetch: typeof fetch
  now: () => number
  locks?: { request: (name: string, cb: () => Promise<string | null>) => Promise<string | null> }
}

/** The token's expiry in ms, or null when it can't be read. */
export function adminTokenExpiresAt(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

function isFresh(token: string | null, env: AdminTokenEnv, marginMs: number): token is string {
  if (!token) return false
  const exp = adminTokenExpiresAt(token)
  return exp !== null && exp - env.now() > marginMs
}

async function refreshNow(env: AdminTokenEnv, marginMs: number): Promise<string | null> {
  // Another tab may have refreshed while this one waited for the lock.
  const current = env.storage.getItem(ADMIN_ACCESS_TOKEN_KEY)
  if (isFresh(current, env, marginMs)) return current

  const refreshToken = env.storage.getItem(ADMIN_REFRESH_TOKEN_KEY)
  if (!refreshToken) return null
  try {
    const res = await env.fetch('/api/admin/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data?.accessToken && data?.refreshToken) {
        env.storage.setItem(ADMIN_ACCESS_TOKEN_KEY, data.accessToken)
        env.storage.setItem(ADMIN_REFRESH_TOKEN_KEY, data.refreshToken)
        return data.accessToken as string
      }
    }
  } catch {
    // Network error: fall through and keep whatever is stored.
  }
  // A tab without Web Locks may have rotated the pair under us.
  if (env.storage.getItem(ADMIN_REFRESH_TOKEN_KEY) !== refreshToken) {
    return env.storage.getItem(ADMIN_ACCESS_TOKEN_KEY)
  }
  return null
}

let inFlight: Promise<string | null> | null = null

/**
 * Returns an access token with at least `marginMs` left, refreshing it first
 * when needed. Null means the session can't be renewed (sign in again).
 */
export function ensureFreshAdminToken(env: AdminTokenEnv, marginMs = ADMIN_REFRESH_MARGIN_MS): Promise<string | null> {
  const current = env.storage.getItem(ADMIN_ACCESS_TOKEN_KEY)
  if (isFresh(current, env, marginMs)) return Promise.resolve(current)
  if (!inFlight) {
    const run = () => refreshNow(env, marginMs)
    inFlight = (env.locks ? env.locks.request('togethr-admin-token-refresh', run) : run())
      .finally(() => { inFlight = null })
  }
  return inFlight
}

/** The browser's storage, fetch and locks. */
export function browserAdminTokenEnv(): AdminTokenEnv | null {
  if (typeof window === 'undefined') return null
  const locks = typeof navigator !== 'undefined' && 'locks' in navigator
    ? (navigator.locks as unknown as AdminTokenEnv['locks'])
    : undefined
  return { storage: window.localStorage, fetch: window.fetch.bind(window), now: Date.now, locks }
}
