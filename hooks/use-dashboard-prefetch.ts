'use client'

import { preload } from 'swr'
import { authFetch } from './use-auth'
import { eventsFetcher, eventsKey, type EventFilters } from './use-events'
import { tasksFetcher, tasksKey } from './use-tasks'
import { subscriptionFetcher, subscriptionKey } from './use-subscription'
import { locationFetcher, locationKey } from '@/components/dashboard-extras'
import { activityFetcher, activityKey, presenceFetcher, presenceKey } from '@/components/dashboard-widgets'
import { readLastFamily } from '@/lib/last-family'

// The dashboard used to load in three rounds, each waiting for the last:
// sign-in check -> the page -> the family's data. This starts the family's
// data at the same time as the sign-in check, for the family the dashboard
// showed last on this device, using the exact SWR keys and fetchers the page
// uses, so the page finds them already loaded (or in flight).

/** Today (local midnight) through 7 days on: the dashboard's event range. */
export function dashboardEventFilters(familyId: string, now = new Date()): EventFilters {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const sevenDaysLater = new Date(today)
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)
  return { familyId, startDate: today.toISOString(), endDate: sevenDaysLater.toISOString() }
}

/** Pending reminders for a family (the dashboard's reminders card). */
export const remindersKey = (familyId: string) => `/api/reminders?status=PENDING&familyId=${encodeURIComponent(familyId)}`

export const remindersFetcher = async (url: string) => {
  const res = await authFetch(url)
  if (!res.ok) throw new Error('Failed to fetch reminders')
  const json = await res.json()
  return (json.data || []) as Array<{ id: string; title: string; remind_at: string; is_recurring: boolean }>
}

/** Start the dashboard's requests for the last family seen here. Never throws. */
export function prefetchDashboard(): void {
  const last = readLastFamily()
  if (!last) return
  const id = last.id
  const jobs: Array<[string | null, (url: string) => Promise<unknown>]> = [
    [eventsKey(dashboardEventFilters(id)), eventsFetcher],
    [tasksKey(id), tasksFetcher],
    [subscriptionKey(id), subscriptionFetcher],
    [remindersKey(id), remindersFetcher],
  ]
  // Guests get no map, activity or presence (the server refuses them).
  if (last.role !== 'GUEST') {
    jobs.push([locationKey(id), locationFetcher], [activityKey(id), activityFetcher], [presenceKey(id), presenceFetcher])
  }
  for (const [key, fetcher] of jobs) {
    if (!key) continue
    try {
      // A failure here is SWR's to retry when the page asks for the same key.
      preload(key, fetcher)?.catch?.(() => {})
    } catch {
      // ignore
    }
  }
}
