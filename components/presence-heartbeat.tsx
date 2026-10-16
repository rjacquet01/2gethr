'use client'

import { useEffect } from 'react'
import { authFetch } from '@/hooks/use-auth'

const BEAT_MS = 2 * 60 * 1000

// Tells the server "I'm here" while the app is open and visible, so family
// members see a green dot. Nothing is sent while the tab is hidden.
export function PresenceHeartbeat() {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== 'visible') return
      authFetch('/api/presence', { method: 'POST' }).catch(() => {})
    }
    beat()
    const timer = setInterval(beat, BEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
