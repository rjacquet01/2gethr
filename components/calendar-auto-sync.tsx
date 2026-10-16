'use client'

import { useEffect, useRef } from 'react'
import { useCalendarSync, CalendarSyncConnection } from '@/hooks/use-calendar-sync'
import { authFetch } from '@/hooks/use-auth'

/**
 * Runs the calendar/task auto-sync loop in the background for as long as
 * the app is open, at whatever interval the user picked in
 * Settings > Calendar Sync (1/10/30/60 min — see
 * app/(dashboard)/settings/calendar-sync/page.tsx).
 *
 * Mounted once in the dashboard layout (not the calendar-sync settings
 * page itself) so auto-sync keeps running no matter which page of the app
 * the user is on, not just while they happen to have that settings page
 * open.
 *
 * There is deliberately no server-side cron doing this: Vercel Cron on
 * this project's plan only runs each job once/day (see
 * app/api/cron/reminders/route.ts), far too coarse for a 1-minute
 * interval, and a true always-on push sync would need a paid plan or an
 * external scheduler. This client-side timer is the realistic mechanism
 * for "while the app is open"; it renders nothing.
 *
 * Calendar sync and task sync each get their own timer, at their own
 * independently-configurable interval (syncIntervalMinutes vs
 * taskSyncIntervalMinutes) — previously task sync had no timer at all and
 * only ran when the user clicked "Sync Tasks Now" by hand.
 */
export function CalendarAutoSync() {
  const { googleConnection, appleConnection, syncNow } = useCalendarSync()

  useCalendarTimer(googleConnection, 'google', syncNow)
  useTaskTimer(googleConnection, '/api/calendar-sync/google/tasks')
  useCalendarTimer(appleConnection, 'apple', syncNow)
  useTaskTimer(appleConnection, '/api/calendar-sync/apple/tasks')

  return null
}

function useCalendarTimer(
  connection: CalendarSyncConnection | undefined,
  provider: 'google' | 'apple',
  syncNow: (provider: 'google' | 'apple') => Promise<unknown>
) {
  const isSyncingRef = useRef(false)

  useEffect(() => {
    if (!connection?.syncEnabled) return

    const intervalMs = (connection.syncIntervalMinutes || 30) * 60 * 1000

    const tick = async () => {
      if (isSyncingRef.current) return // don't overlap a slow sync with the next tick
      // A hidden tab doesn't need to sync: the server cron covers background sync.
      if (document.hidden) return
      isSyncingRef.current = true
      try {
        await syncNow(provider)
      } catch {
        // syncNow already records syncError; auto-sync just quietly retries next tick.
      } finally {
        isSyncingRef.current = false
      }
    }

    const id = setInterval(tick, intervalMs)
    return () => clearInterval(id)
    // Re-create the timer whenever the connection, its enabled flag, or its
    // chosen interval changes, so a settings change takes effect immediately.
  }, [connection?.syncEnabled, connection?.syncIntervalMinutes, provider, syncNow])
}

function useTaskTimer(connection: CalendarSyncConnection | undefined, endpoint: string) {
  const isSyncingRef = useRef(false)

  useEffect(() => {
    if (!connection?.syncEnabled || !connection?.syncTasks) return

    const intervalMs = (connection.taskSyncIntervalMinutes || 30) * 60 * 1000

    const tick = async () => {
      if (isSyncingRef.current) return
      // A hidden tab doesn't need to sync: the server cron covers background sync.
      if (document.hidden) return
      isSyncingRef.current = true
      try {
        await authFetch(endpoint, { method: 'POST' })
      } catch {
        // Quietly retry on the next tick.
      } finally {
        isSyncingRef.current = false
      }
    }

    const id = setInterval(tick, intervalMs)
    return () => clearInterval(id)
  }, [connection?.syncEnabled, connection?.syncTasks, connection?.taskSyncIntervalMinutes, endpoint])
}
