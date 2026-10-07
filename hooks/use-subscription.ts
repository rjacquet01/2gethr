'use client'

import useSWR from 'swr'
import { useCallback } from 'react'
import { authFetch } from './use-auth'
import {
  listTierDefinitions,
  type TierFeatureFlags,
} from '@/lib/subscription-tiers'

export interface Subscription {
  id: string
  familyId: string
  tier: 'FREE' | 'PREMIUM' | 'PREMIUM_PLUS'
  status: 'ACTIVE' | 'TRIALING' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE'
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
}

export interface PremiumAccess {
  hasPremium: boolean
  tier: string
  /** Human-readable bullets for the current tier (what's shown with a checkmark). */
  features: string[]
  /**
   * The actual per-capability booleans for the current tier - e.g.
   * `featureFlags.smsNotifications`. Prefer this (via `canUseFeature`)
   * over comparing `tier === 'PREMIUM_PLUS'` by name when deciding
   * whether to show/gate something, so a tier's entitlements only have
   * to change in lib/subscription-tiers.ts to take effect everywhere.
   */
  featureFlags: TierFeatureFlags
  limits: {
    maxChildren: number
    historyDays: number
    maxSavedPlaces: number
    maxFamilyMembers: number
    maxCalendars: number
  }
}

export interface SubscriptionTierInfo {
  name: string
  description: string
  price: { monthly: number; annual: number }
  features: string[]
}

const DEFAULT_FEATURE_FLAGS: TierFeatureFlags = {
  locationSharing: false,
  geofencing: false,
  advancedRecurrence: false,
  exportCalendar: false,
  prioritySupport: false,
  phoneAlerts: false,
  smsNotifications: false,
  customReminderTimes: false,
}

interface APISubscriptionResponse {
  success: boolean
  data?: {
    id?: string
    tier: string
    status: string
    currentPeriodStart?: string
    currentPeriodEnd?: string
    cancelAtPeriodEnd?: boolean
    trialEndsAt?: string
    tierInfo: {
      features: {
        maxFamilyMembers: number
        maxSavedPlaces: number
        maxCalendars: number
        historyDays: number
        maxChildren: number
        locationSharing: boolean
        geofencing: boolean
        advancedRecurrence: boolean
        exportCalendar: boolean
        prioritySupport: boolean
        phoneAlerts: boolean
        smsNotifications: boolean
        customReminderTimes: boolean
      }
      featureList: string[]
    }
  }
}

const FREE_ACCESS_FALLBACK: PremiumAccess = {
  hasPremium: false,
  tier: 'FREE',
  features: [],
  featureFlags: { ...DEFAULT_FEATURE_FLAGS, locationSharing: true },
  limits: { maxChildren: 2, historyDays: 30, maxSavedPlaces: 2, maxFamilyMembers: 4, maxCalendars: 2 },
}

const fetcher = async (url: string): Promise<{ subscription: Subscription | null; access: PremiumAccess }> => {
  const res = await authFetch(url, { credentials: 'include' })
  if (!res.ok) {
    if (res.status === 401) throw new Error('Unauthorized')
    if (res.status === 404) return { subscription: null, access: FREE_ACCESS_FALLBACK }
    throw new Error('Failed to fetch')
  }

  const json: APISubscriptionResponse = await res.json()

  if (!json.success || !json.data) {
    return { subscription: null, access: FREE_ACCESS_FALLBACK }
  }

  const { data } = json
  const tierFeatures = data.tierInfo?.features || {} as Record<string, number | boolean>
  const hasPremium = data.tier !== 'FREE'

  return {
    subscription: data.id ? {
      id: data.id,
      familyId: '', // will be filled by context
      tier: data.tier as Subscription['tier'],
      status: data.status as Subscription['status'],
      currentPeriodStart: data.currentPeriodStart || null,
      currentPeriodEnd: data.currentPeriodEnd || null,
      trialEnd: data.trialEndsAt || null,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd || false,
    } : null,
    access: {
      hasPremium,
      tier: data.tier,
      features: data.tierInfo?.featureList || [],
      // The real per-capability flags, straight from the API's tierInfo -
      // this is what makes it possible to check "can this user actually
      // use SMS notifications/location sharing/etc" instead of only
      // knowing the tier name.
      featureFlags: {
        locationSharing: !!tierFeatures.locationSharing,
        geofencing: !!tierFeatures.geofencing,
        advancedRecurrence: !!tierFeatures.advancedRecurrence,
        exportCalendar: !!tierFeatures.exportCalendar,
        prioritySupport: !!tierFeatures.prioritySupport,
        phoneAlerts: !!tierFeatures.phoneAlerts,
        smsNotifications: !!tierFeatures.smsNotifications,
        customReminderTimes: !!tierFeatures.customReminderTimes,
      },
      limits: {
        maxChildren: (tierFeatures.maxChildren as number) ?? 2,
        historyDays: (tierFeatures.historyDays as number) ?? 30,
        maxSavedPlaces: (tierFeatures.maxSavedPlaces as number) || 5,
        maxFamilyMembers: (tierFeatures.maxFamilyMembers as number) || 4,
        maxCalendars: (tierFeatures.maxCalendars as number) || 2,
      },
    },
  }
}

export function useSubscription(familyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{
    subscription: Subscription | null
    access: PremiumAccess
  }>(
    familyId ? `/api/subscriptions?familyId=${familyId}` : null,
    fetcher
  )
  
  const cancelTrial = useCallback(async () => {
    if (!familyId) return { success: false, error: 'No family selected' }

    try {
      const res = await authFetch(`/api/subscriptions/${familyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_trial' }),
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      await mutate()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  }, [familyId, mutate])

  const startTrial = useCallback(async (tier: 'PREMIUM' | 'PREMIUM_PLUS' = 'PREMIUM') => {
    if (!familyId) return { success: false, error: 'No family selected' }

    try {
      const res = await authFetch(`/api/subscriptions/${familyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_trial', tier }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        return { success: false, error: data.error }
      }
      
      await mutate()
      return { success: true, subscription: data.subscription }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [familyId, mutate])
  
  
  // Checks the real per-capability flag for the family's current tier -
  // e.g. canUseFeature('smsNotifications') - rather than the old
  // (unused, and broken: it compared a feature *key* against the
  // human-readable bullet *text*, so it could never actually match
  // anything) string-matching against the display featureList.
  const canUseFeature = useCallback((feature: keyof TierFeatureFlags) => {
    if (!data?.access) return false
    return !!data.access.featureFlags[feature]
  }, [data])

  return {
    subscription: data?.subscription || null,
    access: data?.access || FREE_ACCESS_FALLBACK,
    isLoading,
    error,
    startTrial,
    cancelTrial,
    canUseFeature,
    mutate,
  }
}

// Pulled from the same lib/subscription-tiers.ts definitions the backend
// uses, instead of a separately hand-maintained (and previously
// out-of-date - $3.99/$7.99 here vs $2.99/$4.99 on the public pricing
// page) copy.
export function useSubscriptionTiers(): SubscriptionTierInfo[] {
  return listTierDefinitions().map((def) => ({
    name: def.name,
    description: def.description,
    price: { monthly: def.priceMonthlyCents / 100, annual: def.priceAnnualCents / 100 },
    features: def.featureList,
  }))
}
