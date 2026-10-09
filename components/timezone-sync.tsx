'use client'

import { useEffect } from 'react'
import { authFetch, detectBrowserTimeZone } from '@/hooks/use-auth'

/**
 * Keeps the account timezone correct without the user having to do anything.
 *
 * Accounts used to be created with the placeholder timezone "UTC" (the
 * signup form never sent the real one), and everything that depends on the
 * local clock - reminder quiet hours, which day a task is due on a
 * subscribed calendar, recurring-event times - was computed in UTC. If the
 * saved timezone is missing or "UTC" but this device is somewhere else,
 * save the device's timezone once. A genuine UTC device is left alone, and a
 * timezone someone deliberately picked is never overwritten.
 */
export function TimezoneSync() {
  useEffect(() => {
    const deviceTz = detectBrowserTimeZone()
    if (!deviceTz || deviceTz === 'UTC' || deviceTz === 'Etc/UTC') return

    try {
      if (sessionStorage.getItem('tz-synced') === deviceTz) return
    } catch {
      // sessionStorage unavailable - just run the check
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch('/api/auth/profile')
        if (!res.ok) return
        const data = await res.json()
        const saved: string | null | undefined = data?.data?.timezone ?? data?.profile?.timezone ?? data?.timezone
        if (cancelled) return
        if (!saved || saved === 'UTC' || saved === 'Etc/UTC') {
          await authFetch('/api/auth/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone: deviceTz }),
          })
        }
        try {
          sessionStorage.setItem('tz-synced', deviceTz)
        } catch {
          // ignore
        }
      } catch {
        // Best effort; try again next visit.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
