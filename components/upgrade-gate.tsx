'use client'

import type { ReactNode } from 'react'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import { IN_APP_UPGRADE_COPY } from '@/lib/plan-limits'

/**
 * Wrap every upgrade / "see plans" link or button in this. On the website it
 * renders the link; inside the Android app (Google Play rules, detection in
 * hooks/use-purchase-ui.ts) it renders neutral text with no link instead.
 * Nothing renders until the check has run, so the app never flashes a link.
 */
export function UpgradeGate({ children, inApp }: { children: ReactNode; inApp?: ReactNode }) {
  const { ready, canPurchase } = usePurchaseUi()
  return <UpgradeGateView ready={ready} canPurchase={canPurchase} inApp={inApp}>{children}</UpgradeGateView>
}

/** What UpgradeGate shows for a given state (separate so it can be tested). */
export function UpgradeGateView({
  ready,
  canPurchase,
  children,
  inApp,
}: {
  ready: boolean
  canPurchase: boolean
  children: ReactNode
  inApp?: ReactNode
}) {
  if (!ready) return null
  if (canPurchase) return <>{children}</>
  return <>{inApp === undefined ? <span className="text-sm text-muted-foreground">{IN_APP_UPGRADE_COPY}</span> : inApp}</>
}

/** Neutral in-app wording for text that mentions upgrading (toasts, hints). */
export function useUpgradeWording(): { inApp: boolean } {
  const { ready, canPurchase } = usePurchaseUi()
  return { inApp: ready && !canPurchase }
}
