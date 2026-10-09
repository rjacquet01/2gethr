'use client'

import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

// Token storage keys
const ACCESS_TOKEN_KEY = 'safe_link_access_token'
const REFRESH_TOKEN_KEY = 'safe_link_refresh_token'

// Token management utilities
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setTokens(accessToken: string, refreshToken: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export interface User {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  displayName: string | null
  avatarUrl: string | null
  phone: string | null
  timezone: string
  createdAt: string
  primaryFamily?: {
    id: string
    name: string
  } | null
  primaryFamilyRole?: string | null
}

export interface AuthState {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  error: Error | null
}

// Authenticated fetch helper
//
// The access token is short-lived (15 minutes) by design - that's expected
// to expire routinely within a single session, not an edge case. Previously
// this helper (and every hook/page that copied its getAccessToken()+fetch
// pattern instead of using it) just sent the stale token and let the 401
// bubble up as a generic failure - "Failed to update task", "Failed to
// enable push notifications", etc. - any time 15 minutes had passed since
// login, whether or not the person was still actively using the app. Only
// the SWR fetcher behind useAuth()'s own /api/auth/me call happened to
// retry with a refreshed token.
//
// This now does the same silent refresh-and-retry for every caller: on a
// 401, it exchanges the stored refresh token for a new access token via
// /api/auth/refresh, stores it, and retries the original request once
// before giving up and clearing tokens (which signs the person out).
/** The device's IANA timezone (e.g. America/New_York), or 'UTC' if it can't be read. */
export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const headers = new Headers(options.headers)

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(url, { ...options, headers })

  if (res.status !== 401) {
    return res
  }

  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    return res
  }

  try {
    const refreshRes = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!refreshRes.ok) {
      clearTokens()
      return res
    }

    const refreshData = await refreshRes.json()
    const newAccessToken = refreshData?.data?.tokens?.accessToken
    if (!newAccessToken) {
      clearTokens()
      return res
    }

    setTokens(newAccessToken, refreshToken)

    const retryHeaders = new Headers(options.headers)
    retryHeaders.set('Authorization', `Bearer ${newAccessToken}`)
    return fetch(url, { ...options, headers: retryHeaders })
  } catch {
    // Network error during refresh - surface the original 401 rather than
    // masking it with an unrelated throw.
    return res
  }
}

const fetcher = async (url: string) => {
  const token = getAccessToken()
  
  if (!token) {
    return null
  }
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
  
  if (!res.ok) {
    if (res.status === 401) {
      // Try to refresh token
      const refreshToken = getRefreshToken()
      if (refreshToken) {
        const refreshRes = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json()
          if (refreshData.data?.tokens) {
            setTokens(refreshData.data.tokens.accessToken, refreshToken)
            // Retry the original request
            const retryRes = await fetch(url, {
              headers: {
                'Authorization': `Bearer ${refreshData.data.tokens.accessToken}`,
              },
            })
            if (retryRes.ok) {
              return retryRes.json()
            }
          }
        }
      }
      clearTokens()
      return null
    }
    throw new Error('Failed to fetch user')
  }
  return res.json()
}

export function useAuth(): AuthState & {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; requiresTwoFactor?: boolean; challengeToken?: string }>
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<{ success: boolean; error?: string }>
  register: (data: { email: string; password: string; displayName?: string; phone?: string; smsConsent?: boolean }) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  updateProfile: (data: Partial<User>) => Promise<{ success: boolean; error?: string }>
  uploadPhoto: (file: File) => Promise<{ success: boolean; pathname?: string; error?: string }>
  mutate: () => void
} {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])
  
  const { data, error, isLoading, mutate } = useSWR<{ user: User } | null>(
    mounted ? '/api/auth/me' : null, 
    fetcher, 
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  )
  
  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      
      const data = await res.json()

      if (!res.ok) {
  return { success: false, error: data.error || 'Login failed' }
  }

  // Password was correct, but the account has 2FA enabled — no session
  // tokens are issued yet. The caller (login page) should prompt for a
  // code and call verifyTwoFactor() with this challengeToken.
  if (data.data?.requiresTwoFactor) {
    return { success: true, requiresTwoFactor: true, challengeToken: data.data.challengeToken }
  }

  // Store tokens from response
  if (data.data?.tokens?.accessToken) {
    const refreshToken = data.data.tokens.refreshToken || data.data.tokens.accessToken
    setTokens(data.data.tokens.accessToken, refreshToken)
  }

  // Force SWR to refetch
      await mutate(undefined, { revalidate: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])

  const verifyTwoFactor = useCallback(async (challengeToken: string, code: string) => {
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, code }),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error || 'Verification failed' }
      }

      if (data.data?.tokens?.accessToken) {
        const refreshToken = data.data.tokens.refreshToken || data.data.tokens.accessToken
        setTokens(data.data.tokens.accessToken, refreshToken)
      }

      await mutate(undefined, { revalidate: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  const register = useCallback(async (registerData: { email: string; password: string; displayName?: string; phone?: string; smsConsent?: boolean }) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send the device's real timezone - without it every account was created
        // as UTC, which broke quiet hours and when tasks/reminders land on calendars.
        body: JSON.stringify({ ...registerData, timezone: detectBrowserTimeZone() }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        return { success: false, error: data.error || 'Registration failed' }
      }
      
      // Store tokens from response
      if (data.data?.tokens?.accessToken) {
        const refreshToken = data.data.tokens.refreshToken || data.data.tokens.accessToken
        setTokens(data.data.tokens.accessToken, refreshToken)
      }
      
      await mutate(undefined, { revalidate: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  const logout = useCallback(async () => {
    clearTokens()
    await mutate(null, false)
    router.push('/login')
  }, [mutate, router])
  
  const updateProfile = useCallback(async (profileData: Partial<User>) => {
    try {
      const res = await authFetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        return { success: false, error: data.error || 'Update failed' }
      }
      
      await mutate()
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  const uploadPhoto = useCallback(async (file: File) => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      
      const res = await authFetch('/api/auth/profile/photo', {
        method: 'POST',
        body: formData,
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        return { success: false, error: data.error || 'Upload failed' }
      }
      
      await mutate()
      return { success: true, pathname: data.pathname }
    } catch (err) {
      return { success: false, error: 'Network error' }
    }
  }, [mutate])
  
  return {
    user: data?.user || null,
    isLoading: !mounted || isLoading,
    isAuthenticated: !!data?.user,
    error: error || null,
    login,
    verifyTwoFactor,
    register,
    logout,
    updateProfile,
    uploadPhoto,
    mutate,
  }
}