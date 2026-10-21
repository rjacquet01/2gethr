// The family the dashboard showed last on this device, and your role in it,
// so the next visit can start loading that family's data while sign-in is
// still being checked (hooks/use-dashboard-prefetch.ts). Only the id and
// role are kept, never any family data, and signing out forgets them.

const KEY = 'togethr:last-family'

export interface LastFamily {
  id: string
  role: string | null
}

export function readLastFamily(): LastFamily | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && typeof v.id === 'string' ? { id: v.id, role: typeof v.role === 'string' ? v.role : null } : null
  } catch {
    return null
  }
}

export function rememberLastFamily(id: string, role: string | null | undefined): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, role: role ?? null }))
  } catch {
    // Private mode / blocked storage: the dashboard just loads without a head start.
  }
}

export function forgetLastFamily(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
