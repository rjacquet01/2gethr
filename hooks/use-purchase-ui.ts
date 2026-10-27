'use client'

import { useEffect, useState } from 'react'

// Google Play policy: inside the Android (TWA) app we must not steer users to
// an outside purchase flow (Stripe Checkout, billing portal, pricing page)
// unless the developer is enrolled in Google's external content links
// program, and then only in eligible regions (US). So in the Android app we
// hide every price / upgrade / billing control by default. Subscriptions are
// bought on the website; the same account unlocks premium in the app.
const STORAGE_KEY = 'togethr-android-app'
const COOKIE = 'togethr_android'
const EXTERNAL_LINKS_ENABLED = process.env.NEXT_PUBLIC_PLAY_EXTERNAL_LINKS === 'true'

// The flag lives in sessionStorage, which belongs to the app's own tab: the
// TWA shares cookies and localStorage with the phone's browser, so a lasting
// flag there hid every upgrade option on the normal website too. The cookie
// (read by the server) is re-set by the app tab on each load and cleared by
// any other tab.
export function detectAndroidApp(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY) // old, browser-wide flag
    // The app's first page carries an android-app:// referrer; a start URL
    // with ?source=android-app (lib/android-app.ts) is the same signal.
    const fromApp =
      document.referrer.startsWith('android-app://') ||
      new URLSearchParams(window.location.search).get('source') === 'android-app'
    if (fromApp) {
      sessionStorage.setItem(STORAGE_KEY, '1')
    }
    const is = sessionStorage.getItem(STORAGE_KEY) === '1'
    // Lets the server refuse checkout/portal requests from the Android app.
    document.cookie = is
      ? `${COOKIE}=1; path=/; SameSite=Lax; Secure`
      : `${COOKIE}=; path=/; max-age=0; SameSite=Lax; Secure`
    return is
  } catch {
    return false
  }
}

// After the first hydration, components that mount later (most pages, which
// wait for sign-in) can read the flag straight away instead of one render
// later, so the app never shows an upgrade link or price for a frame.
let hydrated = false

/** Called once the first page has hydrated (components/android-app-detector.tsx). */
export function markPurchaseUiHydrated() {
  hydrated = true
}

function initialState(): { ready: boolean; isAndroidApp: boolean } {
  if (!hydrated || typeof window === 'undefined') return { ready: false, isAndroidApp: false }
  const android = detectAndroidApp()
  return { ready: !(android && EXTERNAL_LINKS_ENABLED), isAndroidApp: android }
}

export function usePurchaseUi() {
  const [init] = useState(initialState)
  const [ready, setReady] = useState(init.ready)
  const [isAndroidApp, setIsAndroidApp] = useState(init.isAndroidApp)
  const [country, setCountry] = useState<string | null>(null)

  useEffect(() => {
    hydrated = true
    const android = detectAndroidApp()
    setIsAndroidApp(android)
    if (android && EXTERNAL_LINKS_ENABLED) {
      fetch('/api/platform/region')
        .then((r) => r.json())
        .then((d) => setCountry(d.country || null))
        .catch(() => setCountry(null))
        .finally(() => setReady(true))
    } else {
      setReady(true)
    }
  }, [])

  const canPurchase = ready && (!isAndroidApp || (EXTERNAL_LINKS_ENABLED && country === 'US'))
  return { ready, isAndroidApp, canPurchase }
}
