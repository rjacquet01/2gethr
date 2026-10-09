'use client'

import useSWR from 'swr'
import { useCallback, useState } from 'react'
import { authFetch } from './use-auth'

export interface CalendarSyncConnection {
  id: string
  provider: 'google' | 'apple'
  calendarName: string
  externalCalendarId: string
  syncEnabled: boolean
  syncDirection: 'import' | 'export' | 'both'
  syncTasks: boolean
  appleTasksAvailable?: boolean
  /** Auto-sync cadence in minutes: 1, 10, 30, or 60. See components/calendar-auto-sync.tsx. */
  syncIntervalMinutes: number
  /** Task auto-sync cadence in minutes: 1, 10, 30, or 60. Independent from syncIntervalMinutes. */
  taskSyncIntervalMinutes: number
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

const fetcher = async (url: string) => {
  const res = await authFetch(url)
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function useCalendarSync() {
  const { data, error, isLoading, mutate } = useSWR<{ connections: CalendarSyncConnection[] }>(
    '/api/calendar-sync/connections',
    fetcher
  )

  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const connectGoogle = useCallback(async () => {
    const res = await authFetch('/api/calendar-sync/google/auth')
    const data = await res.json()
    
    if (data.success && data.authUrl) {
      window.location.href = data.authUrl
    } else {
      throw new Error(data.error || 'Failed to start Google auth')
    }
  }, [])

  const disconnect = useCallback(async (connectionId: string) => {
    const res = await authFetch('/api/calendar-sync/connections', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId }),
    })
    
    if (res.ok) {
      mutate()
    } else {
      const data = await res.json()
      throw new Error(data.error || 'Failed to disconnect')
    }
  }, [mutate])

  const updateConnection = useCallback(async (
    connectionId: string,
    updates: { syncEnabled?: boolean; syncDirection?: string; syncIntervalMinutes?: number; taskSyncIntervalMinutes?: number; syncTasks?: boolean }
  ) => {
    const res = await authFetch('/api/calendar-sync/connections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, ...updates }),
    })
    
    if (res.ok) {
      mutate()
    } else {
      const data = await res.json()
      throw new Error(data.error || 'Failed to update connection')
    }
  }, [mutate])

  const syncNow = useCallback(async (provider: 'google' | 'apple') => {
    setIsSyncing(true)
    setSyncError(null)

    try {
      const res = await authFetch(`/api/calendar-sync/${provider}/sync`, {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Sync failed')
      }

      mutate()
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      setSyncError(message)
      throw err
    } finally {
      setIsSyncing(false)
    }
  }, [mutate])

  const connectApple = useCallback(async (appleId: string, appPassword: string) => {
    const res = await authFetch('/api/calendar-sync/apple/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appleId, appPassword }),
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to connect Apple account')
    }

    mutate()
    return data
  }, [mutate])

  const googleConnection = data?.connections?.find(c => c.provider === 'google')
  const appleConnection = data?.connections?.find(c => c.provider === 'apple')

  return {
    connections: data?.connections || [],
    googleConnection,
    appleConnection,
    isLoading,
    error,
    isSyncing,
    syncError,
    connectGoogle,
    connectApple,
    disconnect,
    updateConnection,
    syncNow,
    refresh: mutate,
  }
}
