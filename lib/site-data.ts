// When a browser blocks site data for mytogethr.com (Chrome: Site settings →
// On-device site data), every localStorage access throws a SecurityError and
// the session cookies aren't kept. Sign-in then "succeeded" on the server but
// the page showed "Network error". These helpers never throw, and the
// message tells the person what to change.

export const SITE_DATA_BLOCKED_MESSAGE =
  "Your browser is blocking site data for mytogethr.com, so you can't stay signed in. " +
  "Allow site data (cookies) for mytogethr.com in your browser settings, then try again."

/** True when this browser won't let the page store anything. */
export function siteDataBlocked(): boolean {
  if (typeof window === "undefined") return false
  try {
    const key = "__togethr_storage_probe"
    window.localStorage.setItem(key, "1")
    window.localStorage.removeItem(key)
    return false
  } catch {
    return true
  }
}

export function readStored(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): boolean {
  if (typeof window === "undefined") return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStored(key: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Blocked storage: nothing was stored either.
  }
}
