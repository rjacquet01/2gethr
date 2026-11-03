'use client'

import { useEffect } from 'react'
import { detectSignupSource, type SignupSource } from '@/lib/signup-source'

// Remembers the first link that brought this browser here (lib/signup-source.ts)
// for 30 days, the first one with a clue winning, so sign-up can say where the
// family came from. Only a short label is kept, in this browser; it is sent
// once, with the sign-up form.
const KEY = 'togethr-signup-source'
const KEEP_MS = 30 * 86_400_000

interface Stored extends SignupSource {
  at: number
}

function readStored(): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as Stored | null
    return v && typeof v.source === 'string' && Date.now() - v.at < KEEP_MS ? v : null
  } catch {
    return null
  }
}

/** The remembered source for the sign-up form, or null. */
export function storedSignupSource(): SignupSource | null {
  const v = readStored()
  return v ? (v.campaign ? { source: v.source, campaign: v.campaign } : { source: v.source }) : null
}

/** mytogethr.com, carrying the remembered source (for links copied into Safari). */
export function siteLinkWithSource(base = 'https://mytogethr.com'): string {
  const s = storedSignupSource()
  return s ? `${base}/?ref=${encodeURIComponent(s.source)}` : base
}

export function SourceCapture() {
  useEffect(() => {
    if (readStored()) return
    const found = detectSignupSource({
      search: window.location.search,
      referrer: document.referrer,
      ownHost: window.location.hostname,
      ua: navigator.userAgent,
    })
    // Nothing found: store nothing, so a later tagged visit still counts
    // (sign-up records "direct" when there's no source).
    if (!found) return
    const value: Stored = { ...found, at: Date.now() }
    try {
      localStorage.setItem(KEY, JSON.stringify(value))
    } catch {
      // Storage unavailable: the sign-up just has no source.
    }
  }, [])
  return null
}
