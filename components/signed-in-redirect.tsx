'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'

/**
 * Sends someone who is already signed in on to the app. Used on the landing
 * and login pages: the Android app always opens at "/", and a valid session
 * should land on the dashboard, not on the marketing page or a login form.
 * It relies on the same /api/auth/me check the dashboard uses, so a stale or
 * revoked session never bounces back and forth.
 */
export function SignedInRedirect({ to = '/dashboard' }: { to?: string | (() => string) }) {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(typeof to === 'function' ? to() : to)
  }, [isAuthenticated, isLoading, router, to])

  return null
}
