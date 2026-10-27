'use client'

import type { ReactNode } from 'react'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'

/**
 * Hides prices, plan comparisons and upgrade links inside the Android app
 * (Google Play billing rules; detection: hooks/use-purchase-ui.ts). The page
 * is rendered as usual first, so crawlers and browsers still get it.
 */
export function HideInAndroidApp({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { ready, canPurchase } = usePurchaseUi()
  return <>{ready && !canPurchase ? fallback : children}</>
}
