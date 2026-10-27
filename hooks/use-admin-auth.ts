'use client'

import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import {
  ADMIN_ACCESS_TOKEN_KEY,
  ADMIN_REFRESH_TOKEN_KEY,
  browserAdminTokenEnv,
  ensureFreshAdminToken,
} from '@/lib/admin-token-refresh'

/** Refreshes the admin access token when it is close to expiring. */
export async function refreshAdminTokenIfNeeded(): Promise<string | null> {
  const env = browserAdminTokenEnv()
  return env ? ensureFreshAdminToken(env) : null
}

// Token management utilities
export function getAdminAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ADMIN_ACCESS_TOKEN_KEY)
}

export function setAdminTokens(accessToken: string, refreshToken: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ADMIN_ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(ADMIN_REFRESH_TOKEN_KEY, refreshToken)
}

export function clearAdminTokens() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY)
  localStorage.removeItem(ADMIN_REFRESH_TOKEN_KEY)
}

export function getAdminRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ADMIN_REFRESH_TOKEN_KEY)
}

export interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  roles: string[]
  permissions: string[]
}

// Fetcher for admin auth
async function adminFetcher(url: string): Promise<AdminUser | null> {
  const token = (await refreshAdminTokenIfNeeded()) ?? getAdminAccessToken()
  if (!token) return null

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearAdminTokens()
      return null
    }
    throw new Error('Failed to fetch admin')
  }
  
  const data = await res.json()
  return data.admin
}

export function useAdminAuth() {
  const router = useRouter()
  const { data: admin, error, isLoading, mutate } = useSWR<AdminUser | null>(
    '/api/admin/auth/me',
    adminFetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  )

  const logout = useCallback(async () => {
    const token = getAdminAccessToken()
    try {
      // The refresh token lets the server end the sessions even if the access
      // token has already expired.
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ refreshToken: getAdminRefreshToken() }),
      })
    } catch {
      // Ignore errors
    }
    clearAdminTokens()
    mutate(null, false)
    router.push('/admin/login')
  }, [mutate, router])

  // Mirrors lib/admin-auth.ts's server-side hasPermission(): super admins have
  // every permission, everyone else needs the permission explicitly granted.
  // Kept as a plain client-safe function here since lib/admin-auth.ts pulls in
  // next/headers/bcryptjs/db and can't be imported from a 'use client' page.
  const hasPermission = useCallback((permission: string) => {
    if (!admin) return false
    if (admin.roles.includes('SUPER_ADMIN')) return true
    return admin.permissions.includes(permission)
  }, [admin])

  return {
    admin,
    isLoading,
    isAuthenticated: !!admin,
    error,
    logout,
    mutate,
    hasPermission,
  }
}
