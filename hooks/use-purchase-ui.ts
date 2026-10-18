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
    if (document.referrer.startsWith('android-app://')) {
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

export function usePurchaseUi() {
  const [ready, setReady] = useState(false)
  const [isAndroidApp, setIsAndroidApp] = useState(false)
  const [country, setCountry] = useState<string | null>(null)

  useEffect(() => {
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
