'use client'

import { Analytics } from '@vercel/analytics/next'

// Vercel Analytics (cookieless page views) is the only analytics in the app.
// No events are sent from a device where a child account has been signed in:
// the flag is set as soon as a child signs up or their role is known, and
// stays until an adult account is detected on the same device.
const KEY = 'togethr-no-analytics'

export function markChildDevice(isChild: boolean): void {
  try {
    if (isChild) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable: nothing to remember.
  }
}

function analyticsOff(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function PrivacyAnalytics() {
  return <Analytics beforeSend={(event) => (analyticsOff() ? null : event)} />
}
