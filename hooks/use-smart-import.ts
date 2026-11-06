'use client'

import useSWR from 'swr'
import { authFetch } from '@/hooks/use-auth'

export interface SmartImportStatus {
  enabled: true
  used: number
  limit: number
  upgradeTo: { key: string; name: string; limit: number } | null
}

// Smart Import availability for a family: null while the flag is off (the
// route answers 404) or for children and guests (403), so callers hide the buttons.
const fetcher = async (url: string): Promise<SmartImportStatus | null> => {
  const res = await authFetch(url)
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  return (json?.data as SmartImportStatus) ?? null
}

export function useSmartImport(familyId: string | null | undefined) {
  const { data, isLoading, mutate } = useSWR(familyId ? `/api/import/events?familyId=${familyId}` : null, fetcher, {
    revalidateOnFocus: false,
  })
  return { status: data ?? null, isLoading, refresh: mutate }
}
