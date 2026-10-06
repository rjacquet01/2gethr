'use client'

import useSWR from 'swr'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { authFetch } from './use-auth'

export interface FamilyMember {
  id: string
  userId: string
  familyId: string
  role: 'PARENT' | 'GUARDIAN' | 'CHILD'
  displayName: string
  avatarUrl: string | null
  permissions: Record<string, boolean>
  isActive: boolean
  joinedAt: string
}

export interface ChildProfile {
  id: string
  familyId: string
  displayName: string
  birthDate: string | null
  avatarUrl: string | null
  grade: string | null
  permissions: {
    canCreateEvents: boolean
    requiresApproval: boolean
    canViewFamilyCalendar: boolean
    locationSharingEnabled: boolean
  }
  createdAt: string
}

export interface Family {
  id: string
  name: string
  ownerId: string
  inviteCode: string | null
  createdAt: string
  members: FamilyMember[]
  children: ChildProfile[]
}

const fetcher = async (url: string) => {
  const res = await authFetch(url)
  if (!res.ok) {
    if (res.status === 401) throw new Error('Unauthorized')
    throw new Error('Failed to fetch')
  }
  return res.json()
}

// Which family the person has chosen to look at, when they belong to more
// than one. Kept in localStorage (a per-device viewing preference) and
// exposed through a tiny external store so every component using
// useFamilies() updates immediately when it changes. useFamilies() puts the
// selected family FIRST in the list it returns, so the many pages that use
// `families[0]` as "the current family" follow the selection with no change.
const SELECTED_FAMILY_KEY = 'togethr-selected-family-id'
const selectedFamilyListeners = new Set<() => void>()

function readSelectedFamilyId(): string | null {
  try {
    return localStorage.getItem(SELECTED_FAMILY_KEY)
  } catch {
    return null
  }
}

function subscribeSelectedFamily(listener: () => void) {
  selectedFamilyListeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === SELECTED_FAMILY_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    selectedFamilyListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setSelectedFamilyId(familyId: string) {
  try {
    localStorage.setItem(SELECTED_FAMILY_KEY, familyId)
  } catch {
    // storage unavailable (private mode) - selection just won't persist
  }
  selectedFamilyListeners.forEach((l) => l())
}

export function useFamilies() {
  const { data, error, isLoading, mutate } = useSWR<{ families: Family[] }>('/api/families', fetcher)
  const storedFamilyId = useSyncExternalStore(subscribeSelectedFamily, readSelectedFamilyId, () => null)

  const families = useMemo(() => {
    const list = data?.families || []
    if (!storedFamilyId) return list
    const idx = list.findIndex((f) => f.id === storedFamilyId)
    if (idx <= 0) return list
    return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)]
  }, [data, storedFamilyId])

  const selectFamily = useCallback((familyId: string) => setSelectedFamilyId(familyId), [])
  
  const createFamily = useCallback(async (name: string) => {
    try {
      const res = await authFetch('/api/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        return { success: false, error: data.error }
      }
      
      await mutate()
      return { success: true, family: data.family }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  const joinFamily = useCallback(async (inviteCode: string) => {
    try {
      const res = await authFetch('/api/families/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
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
  }, [mutate])
  
  return {
    families,
    selectedFamilyId: families[0]?.id ?? null,
    selectFamily,
    isLoading,
    error,
    createFamily,
    joinFamily,
    mutate,
  }
}

export function useFamily(familyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ family: Family }>(
    familyId ? `/api/families/${familyId}` : null,
    fetcher
  )
  
  const updateFamily = useCallback(async (updates: { name?: string }) => {
    if (!familyId) return { success: false, error: 'No family selected' }
    
    try {
      const res = await authFetch(`/api/families/${familyId}`, {
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
  }, [familyId, mutate])
  
  const generateInviteCode = useCallback(async () => {
    if (!familyId) return { success: false, error: 'No family selected' }
    
    try {
      const res = await authFetch(`/api/families/${familyId}/invite`, {
        method: 'POST',
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        return { success: false, error: data.error }
      }
      
      await mutate()
      return { success: true, inviteCode: data.inviteCode }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [familyId, mutate])
  
  const addChild = useCallback(async (childData: {
    displayName: string
    birthDate?: string
    grade?: string
    permissions?: Partial<ChildProfile['permissions']>
    existingMemberId?: string // For assigning existing family members as children
  }) => {
    if (!familyId) return { success: false, error: 'No family selected' }
    
    try {
      const res = await authFetch(`/api/families/${familyId}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(childData),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        return { success: false, error: data.error }
      }
      
      await mutate()
      return { success: true, child: data.child }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [familyId, mutate])
  
  const updateMember = useCallback(async (memberId: string, updates: {
    role?: 'PARENT' | 'GUARDIAN' | 'CHILD'
    permissions?: Record<string, boolean>
  }) => {
    if (!familyId) return { success: false, error: 'No family selected' }
    
    try {
      const res = await authFetch(`/api/families/${familyId}/members/${memberId}`, {
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
  }, [familyId, mutate])
  
  const removeMember = useCallback(async (memberId: string) => {
    if (!familyId) return { success: false, error: 'No family selected' }
    
    try {
      const res = await authFetch(`/api/families/${familyId}/members/${memberId}`, {
        method: 'DELETE',
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
  }, [familyId, mutate])
  
  return {
    family: data?.family || null,
    isLoading,
    error,
    updateFamily,
    generateInviteCode,
    addChild,
    updateMember,
    removeMember,
    mutate,
  }
}
