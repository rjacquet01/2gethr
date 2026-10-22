'use client'

import useSWR from 'swr'
import { useCallback } from 'react'
import { authFetch } from './use-auth'

export interface Notification {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  /** As the API sends it (GET /api/notifications). */
  isRead: boolean
  createdAt: string
}

const fetcher = async (url: string) => {
  const res = await authFetch(url, { credentials: 'include' })
  if (!res.ok) {
    if (res.status === 401) throw new Error('Unauthorized')
    throw new Error('Failed to fetch')
  }
  return res.json()
}

export function useNotifications(options: { limit?: number; unreadOnly?: boolean } = {}) {
  const { limit = 20, unreadOnly = false } = options
  const params = new URLSearchParams()
  params.append('limit', limit.toString())
  if (unreadOnly) params.append('unreadOnly', 'true')
  
  const { data, error, isLoading, mutate } = useSWR<{
    success: boolean
    data: {
      notifications: Notification[]
      unreadCount: number
    }
  }>(`/api/notifications?${params.toString()}`, fetcher, {
    refreshInterval: 30000, // Refresh every 30 seconds
  })
  
  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      const res = await authFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notificationId }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      
      await mutate()
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  const markAllAsRead = useCallback(async () => {
    try {
      const res = await authFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ markAllRead: true }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      
      await mutate()
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  return {
    notifications: data?.data?.notifications || [],
    total: data?.data?.notifications?.length || 0,
    unreadCount: data?.data?.unreadCount || 0,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    mutate,
  }
}
