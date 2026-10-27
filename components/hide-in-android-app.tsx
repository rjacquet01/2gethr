'use client'

import type { ReactNode } from 'react'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'

/**
 * Hides prices, plan comparisons and upgrade links inside the Android app
 * (Google Play billing rules; detection: hooks/use-purchase-ui.ts). Pages that
 * can tell on the server (lib/android-app.ts purchaseBlockedForPage) leave the
 * content out of the page for the app; this covers visits the server could
 * not recognise.
 */
export function HideInAndroidApp({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { ready, canPurchase } = usePurchaseUi()
  return <>{ready && !canPurchase ? fallback : children}</>
}
