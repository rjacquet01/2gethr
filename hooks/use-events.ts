'use client'

import useSWR from 'swr'
import { useCallback } from 'react'
import { getAccessToken, authFetch } from './use-auth'

// Re-export for convenience
export { getAccessToken, authFetch }

export interface Event {
  id: string
  notifyChannels?: string[]
  calendarId: string
  familyId: string
  title: string
  description: string | null
  startTime: string
  endTime: string
  allDay: boolean
  location: string | null
  placeId: string | null
  category: string
  visibility: 'FAMILY' | 'PRIVATE' | 'PARTICIPANTS_ONLY'
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED'
  createdById: string
  createdByChildId: string | null
  requiresApproval: boolean
  approvedById: string | null
  approvedAt: string | null
  recurrenceRuleId: string | null
  isRecurrenceException: boolean
  createdAt: string
  participants?: EventParticipant[]
  recurrenceRule?: RecurrenceRule | null
}

export interface EventParticipant {
  id: string
  eventId: string
  userId: string | null
  childProfileId: string | null
  displayName: string
  responseStatus: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'
}

export interface RecurrenceRule {
  id: string
  eventId: string
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  byDay: string[] | null
  byMonthDay: number[] | null
  byMonth: number[] | null
  until: string | null
  count: number | null
}

export interface EventFilters {
  familyId?: string
  calendarId?: string
  startDate?: string
  endDate?: string
  category?: string
  status?: string
  participantId?: string
}

const fetcher = async (url: string) => {
  const res = await authFetch(url)
  if (!res.ok) throw new Error('Failed to fetch events')
  return res.json()
}

function buildQueryString(filters: EventFilters): string {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.append(key, value)
  })
  return params.toString()
}

export function useEvents(filters: EventFilters = {}) {
  const queryString = buildQueryString(filters)
  // Only fetch if we have at least a familyId or calendarId
  const shouldFetch = !!(filters.familyId || filters.calendarId)
  const url = shouldFetch ? `/api/events${queryString ? `?${queryString}` : ''}` : null
  
  const { data, error, isLoading, mutate } = useSWR<{ events: Event[] }>(url, fetcher)
  
  const createEvent = useCallback(async (eventData: {
    familyId: string
    calendarId?: string
    title: string
    description?: string
    startTime: string
    endTime: string
    allDay?: boolean
    location?: string
    placeId?: string
    category?: string
    visibility?: 'FAMILY' | 'PRIVATE' | 'PARTICIPANTS_ONLY'
    participants?: Array<{ userId?: string; childProfileId?: string }>
    recurrence?: {
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
      interval?: number
      byDay?: string[]
      byMonthDay?: number[]
      byMonth?: number[]
      until?: string
      count?: number
    }
  }) => {
    try {
      const res = await authFetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error }
      }

      await mutate()
      return { success: true, event: data.event }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  return {
    events: data?.events || [],
    isLoading,
    error,
    createEvent,
    mutate,
  }
}

export function useEvent(eventId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ event: Event }>(
    eventId ? `/api/events/${eventId}` : null,
    fetcher
  )
  
  const updateEvent = useCallback(async (updates: Partial<Event>) => {
    if (!eventId) return { success: false, error: 'No event selected' }
    
    try {
      const res = await authFetch(`/api/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error }
      }

      await mutate()
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [eventId, mutate])

  const deleteEvent = useCallback(async (deleteRecurrence: boolean = false) => {
    if (!eventId) return { success: false, error: 'No event selected' }

    try {
      const url = deleteRecurrence
        ? `/api/events/${eventId}?deleteRecurrence=true`
        : `/api/events/${eventId}`

      const res = await authFetch(url, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [eventId])

  const approveEvent = useCallback(async () => {
    if (!eventId) return { success: false, error: 'No event selected' }

    try {
      const res = await authFetch(`/api/events/${eventId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE' }),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error }
      }

      await mutate()
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [eventId, mutate])

  const rejectEvent = useCallback(async (reason?: string) => {
    if (!eventId) return { success: false, error: 'No event selected' }

    try {
      const res = await authFetch(`/api/events/${eventId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REJECT', responseNotes: reason }),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error }
      }

      await mutate()
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [eventId, mutate])
  
  return {
    event: data?.event || null,
    isLoading,
    error,
    updateEvent,
    deleteEvent,
    approveEvent,
    rejectEvent,
    mutate,
  }
}

export function usePendingApprovals(familyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ events: Event[] }>(
    familyId ? `/api/events?familyId=${familyId}&status=PENDING` : null,
    fetcher
  )
  
  const approveEvent = useCallback(async (eventId: string) => {
    try {
      const res = await authFetch(`/api/events/${eventId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE' }),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error }
      }

      await mutate()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])

  const rejectEvent = useCallback(async (eventId: string, reason?: string) => {
    try {
      const res = await authFetch(`/api/events/${eventId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REJECT', responseNotes: reason }),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error }
      }

      await mutate()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  return {
    pendingEvents: data?.events || [],
    isLoading,
    error,
    mutate,
    approveEvent,
    rejectEvent,
  }
}
