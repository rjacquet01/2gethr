'use client'

import { useEffect } from 'react'
import { detectAndroidApp } from '@/hooks/use-purchase-ui'

// Runs on every page so the Android app's tab is recognised on whichever page
// it opens (only that first page carries the android-app:// referrer).
export function AndroidAppDetector() {
  useEffect(() => {
    detectAndroidApp()
  }, [])
  return null
}
