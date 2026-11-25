'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setTokens } from '@/hooks/use-auth'
import { Spinner } from '@/components/ui/spinner'

// Landing page after a successful Google sign-in: the session cookies are set,
// so this moves the tokens into the app's client-side store and continues.
export default function GoogleDonePage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next = (() => {
        try {
          const n = new URLSearchParams(window.location.search).get('next')
          return n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard'
        } catch {
          return '/dashboard'
        }
      })()
      try {
        const res = await fetch('/api/auth/google/handoff', { method: 'POST' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!json?.success) {
          router.replace('/login?google=error')
          return
        }
        setTokens(json.data.tokens.accessToken, json.data.tokens.refreshToken)
        window.location.replace(next)
      } catch {
        if (!cancelled) router.replace('/login?google=error')
      }
    })()
    return () => { cancelled = true }
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner className="h-6 w-6" />
    </div>
  )
}
