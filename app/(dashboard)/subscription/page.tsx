'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { useFamilies } from '@/hooks/use-family'
import { useSubscription, useSubscriptionTiers } from '@/hooks/use-subscription'
import { authFetch } from '@/hooks/use-events'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Empty } from '@/components/ui/empty'
import { toast } from 'sonner'
import {
  Crown,
  Check,
  Sparkles,
  Clock,
  Users,
  AlertCircle,
  CreditCard,
  X,
  Mail,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import { alertPlaceLimit, getTierDefinition, SUBSCRIPTION_TIERS, annualSavingsPercent, TRIAL_DAYS, PRICE_TAX_NOTE } from '@/lib/subscription-tiers'
import { FamilyNameTag } from '@/components/family-name-tag'

export default function SubscriptionPage() {
  const router = useRouter()
  const { canPurchase } = usePurchaseUi()
  const { user, isLoading: authLoading } = useAuth()
  const { families, isLoading: familiesLoading } = useFamilies()
  const [selectedBilling, setSelectedBilling] = useState<'monthly' | 'annual'>('annual')
  const [selectedTierIndex, setSelectedTierIndex] = useState<number | null>(null)

  const primaryFamily = families?.[0]
  // Only the account holder (families.owner_id) can change the plan; invited
  // family members get an explanation instead of a failed request.
  const isOwner = !!primaryFamily && !!user && primaryFamily.ownerId === user.id
  const ownerName = (primaryFamily?.members as unknown as Array<{ userId?: string | null; displayName?: string | null }> | undefined)
    ?.find((m) => m.userId === primaryFamily?.ownerId)?.displayName || null
  const ownerOnly = (): boolean => {
    if (isOwner) return false
    toast.info(`Only the account holder${ownerName ? ` (${ownerName})` : ''} can change this family's plan. Since you were invited to this family, please ask them to upgrade or downgrade.`)
    return true
  }
  const { subscription, access, isLoading: subLoading, startTrial, cancelTrial } = useSubscription(primaryFamily?.id || null)
  const tiers = useSubscriptionTiers()

  const [isStartingTrial, setIsStartingTrial] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const [isCancelingTrial, setIsCancelingTrial] = useState(false)

  // Map tier names to API tier keys
  const tierNameToKey: Record<string, string> = {
    [SUBSCRIPTION_TIERS.FREE.name]: 'FREE',
    [SUBSCRIPTION_TIERS.PREMIUM.name]: 'PREMIUM', // "Plus"
    [SUBSCRIPTION_TIERS.PREMIUM_PLUS.name]: 'PREMIUM_PLUS', // "Premium"
  }

  // Format tier key to display name. This used to hardcode its own
  // name map (and had PREMIUM_PLUS wrong, as "Premium Plus" instead of
  // "Premium"), which drifted out of sync with the canonical tier names
  // in lib/subscription-tiers.ts - the same single-source-of-truth file
  // the pricing cards below already read from via useSubscriptionTiers().
  // Delegating here keeps this page's "Current Plan" badge and "What's
  // included" heading consistent with the pricing cards instead of
  // re-duplicating the mapping a second time.
  const formatTierName = (tier: string) => getTierDefinition(tier).name

  const handleStartTrial = async (tier: 'PREMIUM' | 'PREMIUM_PLUS') => {
    if (ownerOnly()) return
    setIsStartingTrial(true)
    const result = await startTrial(tier)
    setIsStartingTrial(false)

    if (result.success) {
      toast.success(`Trial started! Enjoy ${TRIAL_DAYS} days of premium features.`)
    } else {
      toast.error(result.error || 'Failed to start trial')
    }
  }

  const handleCancelTrial = async () => {
    if (ownerOnly()) return
    setIsCancelingTrial(true)
    const result = await cancelTrial()
    setIsCancelingTrial(false)
    if (result.success) {
      toast.success('Your free trial has been cancelled.')
    } else {
      toast.error(result.error || 'Failed to cancel trial')
    }
  }

  const handleManageBilling = async () => {
    if (ownerOnly()) return
    if (!primaryFamily?.id) return
    setIsCanceling(true)
    try {
      const res = await authFetch('/api/subscription/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: primaryFamily.id }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
      } else {
        toast.error(data.error || 'Failed to open billing portal')
        setIsCanceling(false)
      }
    } catch {
      toast.error('Something went wrong opening the billing portal')
      setIsCanceling(false)
    }
  }

  if (authLoading || familiesLoading || subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (!primaryFamily) {
    return (
      <div className="py-8">
        <Empty
          icon={Users}
          title="No Family Yet"
          description="Create or join a family to manage your subscription."
        />
      </div>
    )
  }

  const currentTier = access.tier.toUpperCase()
  const isTrialing = subscription?.status === 'TRIALING'
  const trialEndsAt = subscription?.trialEnd ? new Date(subscription.trialEnd) : null

  const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0
  const FEATURES = [
    { key: 'locationSharing' as const, label: 'Real-time location sharing' },
    {
      key: 'geofencing' as const,
      label: alertPlaceLimit(currentTier) ? `Arrival & departure alerts (${alertPlaceLimit(currentTier)} places)` : 'Arrival & departure alerts',
    },
    { key: 'smsNotifications' as const, label: 'SMS notifications' },
    { key: 'phoneAlerts' as const, label: 'Emergency alerts to your child' },
    { key: 'customReminderTimes' as const, label: 'Custom reminder times' },
    { key: 'advancedRecurrence' as const, label: 'Advanced recurring events' },
    { key: 'exportCalendar' as const, label: 'Calendar export' },
    { key: 'prioritySupport' as const, label: 'Priority support' },
  ]

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Subscription</h1>
        <FamilyNameTag name={primaryFamily.name} className="mt-1" />
      </div>

      {!isOwner && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
          <span className="font-medium">Plan changes are managed by the account holder.</span>{' '}
          Because you were invited to this family, you cannot upgrade, downgrade or cancel the subscription{ownerName ? <> - please ask {ownerName}</> : ''}.
        </div>
      )}

      {/* Current plan */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Crown className="h-5 w-5 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Current plan</p>
              <p className="text-lg font-semibold leading-tight">
                {formatTierName(currentTier)}
                {isTrialing && <span className="ml-2 text-sm font-normal text-muted-foreground">Trial</span>}
              </p>
            </div>
            {canPurchase && access.hasPremium && !isTrialing && (
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={handleManageBilling} disabled={isCanceling}>
                  {isCanceling ? <Spinner className="h-4 w-4 sm:mr-1.5" /> : <CreditCard className="h-4 w-4 sm:mr-1.5" />}
                  <span className="hidden sm:inline">{subscription?.cancelAtPeriodEnd ? 'Resume / manage' : 'Manage billing'}</span>
                </Button>
                {!subscription?.cancelAtPeriodEnd && (
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleManageBilling} disabled={isCanceling}>
                    Cancel
                  </Button>
                )}
              </div>
            )}
            {isTrialing && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive" disabled={isCancelingTrial}>
                    Cancel trial
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel your free trial?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your family will move to the Free plan right away and lose the premium
                      features. You won&apos;t be charged, and you can subscribe at any time.
                      The free trial can only be used once.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep my trial</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancelTrial}>Cancel trial</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {isTrialing && trialEndsAt && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-2.5 text-sm">
              <Clock className="h-4 w-4 shrink-0" />
              Trial ends {trialEndsAt.toLocaleDateString()} ({daysLeft} day{daysLeft === 1 ? '' : 's'} left)
            </div>
          )}

          {subscription?.cancelAtPeriodEnd && !isTrialing && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Cancelled
                {subscription.currentPeriodEnd ? ` - ends ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}` : ' at the end of the billing period'}
                . You keep premium features until then.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {[
              [access.limits.maxChildren === -1 ? 'Unlimited' : String(access.limits.maxChildren), 'children'],
              [String(access.limits.historyDays), 'days history'],
              [String(access.features.length), 'features'],
            ].map(([v, l]) => (
              <span key={l} className="rounded-full bg-muted px-3 py-1 text-xs">
                <span className="font-semibold">{v}</span> <span className="text-muted-foreground">{l}</span>
              </span>
            ))}
          </div>

          <details className="group rounded-lg border bg-background/60 px-3 py-2">
            <summary className="cursor-pointer list-none text-sm font-medium">
              What&apos;s included in {formatTierName(currentTier)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {FEATURES.filter((f) => access.featureFlags[f.key]).length} of {FEATURES.length}
              </span>
            </summary>
            <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {FEATURES.map(({ key, label }) => {
                const included = access.featureFlags[key]
                return (
                  <li key={key} className="flex items-center gap-2">
                    {included ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <X className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className={included ? '' : 'text-muted-foreground'}>{label}</span>
                  </li>
                )
              })}
            </ul>
          </details>
        </CardContent>
      </Card>

      {canPurchase && (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Plans</h2>
            <div className="inline-flex rounded-lg bg-muted p-1">
              {(
                [
                  ['monthly', 'Monthly'],
                  ['annual', 'Annual'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelectedBilling(k)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    selectedBilling === k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                  {k === 'annual' && <span className="ml-1.5 text-xs text-green-600">Save {annualSavingsPercent(SUBSCRIPTION_TIERS.PREMIUM)}%</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {tiers.map((tier, index) => {
              const tierKey = tierNameToKey[tier.name] || 'FREE'
              const isCurrentTier = tierKey === access.tier
              const isPopular = tier.name === 'Premium'
              const price = selectedBilling === 'monthly' ? tier.price.monthly : tier.price.annual
              const go = () => router.push(`/subscription/upgrade?tier=${tierKey}&billing=${selectedBilling}`)

              return (
                <Card
                  key={tier.name}
                  onClick={() => {
                    if (isCurrentTier || tier.name === 'Free') return
                    if (ownerOnly()) return
                    setSelectedTierIndex(index)
                    go()
                  }}
                  className={cn(
                    'relative flex flex-col overflow-hidden transition-all',
                    isPopular && 'border-primary shadow-md',
                    isCurrentTier && 'ring-2 ring-primary',
                    !isCurrentTier && tier.name !== 'Free' && 'cursor-pointer hover:border-primary/50 hover:shadow-md'
                  )}
                >
                  {isPopular && (
                    <span className="absolute right-0 top-0 rounded-bl-lg bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                      Most popular
                    </span>
                  )}
                  <CardContent className="flex-1 space-y-3 p-4 sm:p-5">
                    <div>
                      <p className="flex items-center gap-2 font-semibold">
                        {tier.name}
                        {isCurrentTier && <Badge variant="outline" className="text-xs">Current</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">{tier.description}</p>
                    </div>
                    <div>
                      <p className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold">${selectedBilling === 'monthly' ? (price > 0 ? price.toFixed(2) : price) : (price / 12).toFixed(2)}</span>
                        <span className="text-sm text-muted-foreground">/month</span>
                      </p>
                      <p className="h-4 text-xs text-muted-foreground">
                        {selectedBilling === 'annual' && price > 0 ? `$${price.toFixed(2)}/year billed annually · about 2 months free` : ''}
                      </p>
                      {/* Same fixed height on every card; empty on Free so the cards line up. */}
                      <p className="h-4 text-xs text-muted-foreground">{price > 0 ? PRICE_TAX_NOTE : ''}</p>
                    </div>
                    <ul className="space-y-1.5">
                      {tier.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </CardContent>

                  <CardFooter className="p-4 pt-0 sm:p-5 sm:pt-0">
                    {isCurrentTier ? (
                      <Button className="w-full" variant="outline" disabled>Current plan</Button>
                    ) : tier.name === 'Free' ? (
                      <Button className="w-full" variant="outline" disabled>Included</Button>
                    ) : !access.hasPremium && index > 0 ? (
                      <div className="w-full space-y-2">
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleStartTrial(tierKey as 'PREMIUM' | 'PREMIUM_PLUS')
                          }}
                          disabled={isStartingTrial}
                        >
                          {isStartingTrial ? <Spinner className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                          Start {TRIAL_DAYS}-day trial
                        </Button>
                        <Button
                          className="w-full"
                          variant={isPopular ? 'default' : 'outline'}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!ownerOnly()) go()
                          }}
                        >
                          <CreditCard className="mr-2 h-4 w-4" />
                          Upgrade now
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        variant={isPopular ? 'default' : 'outline'}
                        onClick={(e) => {
                          e.stopPropagation()
                          go()
                        }}
                      >
                        <CreditCard className="mr-2 h-4 w-4" />
                        {access.tier === 'PREMIUM_PLUS' && tierKey === 'PREMIUM' ? 'Downgrade' : 'Upgrade'}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        </>
      )}

      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">Questions about billing? We&apos;re happy to help.</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/support">Contact support</Link>
        </Button>
      </div>
    </div>
  )
}
