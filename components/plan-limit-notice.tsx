'use client'

import Link from 'next/link'
import useSWR, { mutate } from 'swr'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { authFetch } from '@/hooks/use-auth'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import {
  IN_APP_NEAR_LIMIT_COPY,
  isNearLimit,
  planLimitMessage,
  planUsageLine,
  type PlanLimitKind,
  type PlanLimitResult,
} from '@/lib/plan-limits'

interface UsageEntry {
  used: number
  limit: number | null
  upgradeTo: PlanLimitResult['upgradeTo']
}

interface PlanUsage {
  tier: string
  trial: boolean
  usage: Partial<Record<PlanLimitKind, UsageEntry>>
}

const usageKey = (familyId: string) => `/api/families/${familyId}/plan-usage`

async function fetchUsage(url: string): Promise<PlanUsage> {
  const res = await authFetch(url)
  if (!res.ok) throw new Error('Failed to load plan usage')
  return (await res.json()).data
}

/** Reload the meters after something was added or removed. */
export function refreshPlanUsage(familyId: string | null | undefined) {
  if (familyId) void mutate(usageKey(familyId))
}

/**
 * Usage meter for one plan cap ("9 of 15 events this month"), a soft nudge
 * from 80%, and at the cap a short message with an Upgrade button. Inside the
 * Android app it shows neutral copy and no upgrade link (Google Play rules).
 * Nothing shows on plans without this cap.
 */
export function PlanLimitNotice({
  familyId,
  kind,
  className = '',
}: {
  familyId: string | null | undefined
  kind: PlanLimitKind
  className?: string
}) {
  const { ready, canPurchase } = usePurchaseUi()
  const { data } = useSWR(familyId ? usageKey(familyId) : null, fetchUsage, { revalidateOnFocus: true })
  const entry = data?.usage[kind]
  if (!data || !entry || entry.limit === null) return null

  const r = { kind, used: entry.used, limit: entry.limit, trial: data.trial, upgradeTo: entry.upgradeTo }
  const atLimit = entry.used >= entry.limit
  const near = !atLimit && isNearLimit(r)
  const showUpgrade = ready && canPurchase && !data.trial && !!entry.upgradeTo
  const pct = Math.min(100, Math.round((entry.used / Math.max(entry.limit, 1)) * 100))

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${atLimit ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40' : 'bg-muted/30'} ${className}`}
      data-testid={`plan-limit-${kind}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={atLimit ? 'font-medium text-amber-900 dark:text-amber-100' : 'text-muted-foreground'}>
          {atLimit ? planLimitMessage(r, { inApp: ready && !canPurchase }) : planUsageLine(r)}
        </span>
        {(atLimit || near) && showUpgrade && (
          <Button asChild size="sm" variant={atLimit ? 'default' : 'outline'} className="shrink-0">
            <Link href="/subscription/upgrade">Upgrade</Link>
          </Button>
        )}
      </div>
      <Progress value={pct} className="mt-2 h-1.5" aria-label={planUsageLine(r)} />
      {near && (
        <p className="mt-2 text-xs text-muted-foreground">
          {ready && !canPurchase
            ? IN_APP_NEAR_LIMIT_COPY
            : `You're close to your plan's limit.${showUpgrade ? ` ${entry.upgradeTo!.name} gives you more room.` : ''}`}
        </p>
      )}
    </div>
  )
}
