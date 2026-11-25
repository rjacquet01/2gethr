'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
// Not imported from lib/google-signin.ts: that file pulls server-only code (db, jose)
// into the browser bundle and crashes /login and /register.
const GOOGLE_SIGNIN_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN === 'true'

const MESSAGES: Record<string, string> = {
  exists: 'An account with that email already exists. Sign in with your password, then we can add Google.',
  '2fa': 'This account uses two-step verification. Please sign in with your email and password.',
  unavailable: 'Google sign-in is not available right now.',
  deactivated: 'This account is deactivated.',
  cancelled: 'Google sign-in was cancelled.',
  unverified: 'Google could not verify that email address.',
  busy: 'Too many attempts. Please wait a few minutes and try again.',
  error: 'Google sign-in did not work. Please try again.',
}

// "Continue with Google". Renders nothing until NEXT_PUBLIC_GOOGLE_SIGN_IN=true,
// so the button ships dark. Also shows why a Google round trip sent the person back.
export function GoogleSignInButton({ redirect }: { redirect?: string }) {
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('google')
      if (code && MESSAGES[code]) toast.error(MESSAGES[code])
    } catch {}
  }, [])

  if (!GOOGLE_SIGNIN_ENABLED) return null
  const href = `/api/auth/google/start${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`

  return (
    <div className="mt-4">
      <div className="relative my-4 text-center text-xs text-muted-foreground">
        <span className="bg-background px-2 relative z-10">or</span>
        <div className="absolute inset-x-0 top-1/2 border-t" />
      </div>
      <a
        href={href}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md border bg-background text-sm font-medium hover:bg-accent"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
          <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        Continue with Google
      </a>
    </div>
  )
}
