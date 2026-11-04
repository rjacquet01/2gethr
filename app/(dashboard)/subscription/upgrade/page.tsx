'use client'

import { Suspense, useState, useEffect, useSyncExternalStore } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import Link from 'next/link'
import { useAuth } from '@/hooks/use-auth'
import { useFamilies } from '@/hooks/use-family'
import { authFetch } from '@/hooks/use-events'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Check,
  Lock,
  Shield,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUBSCRIPTION_TIERS, annualSavingsPercent, displayPrice, priceTaxNote } from '@/lib/subscription-tiers'
import { parseUpgradeParams, orderSummaryCents, centsToDollars, planChange, upgradePageCopy, downgradeNotice, type CurrentPlan, type PaidTierKey, type BillingCycle } from '@/lib/upgrade-order'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { FamilyNameTag } from '@/components/family-name-tag'
import { Input } from '@/components/ui/input'
import { useSubscription } from '@/hooks/use-subscription'
import { storedPromoCode } from '@/components/source-capture'
import { describeDiscount, discountCents, type PromoDiscount } from '@/lib/promo-discount'

const noSubscribe = () => () => {}

// Sourced from lib/subscription-tiers.ts rather than a hand-typed copy, so
// this checkout page can't go out of sync with what /pricing and
// /subscription advertise.
const tiers = {
  PREMIUM: {
    name: SUBSCRIPTION_TIERS.PREMIUM.name,
    description: SUBSCRIPTION_TIERS.PREMIUM.description,
    features: SUBSCRIPTION_TIERS.PREMIUM.featureList,
    price: { monthly: SUBSCRIPTION_TIERS.PREMIUM.priceMonthlyCents / 100, annual: SUBSCRIPTION_TIERS.PREMIUM.priceAnnualCents / 100 },
  },
  PREMIUM_PLUS: {
    name: SUBSCRIPTION_TIERS.PREMIUM_PLUS.name,
    description: SUBSCRIPTION_TIERS.PREMIUM_PLUS.description,
    features: SUBSCRIPTION_TIERS.PREMIUM_PLUS.featureList,
    price: { monthly: SUBSCRIPTION_TIERS.PREMIUM_PLUS.priceMonthlyCents / 100, annual: SUBSCRIPTION_TIERS.PREMIUM_PLUS.priceAnnualCents / 100 },
  },
}

// Next.js requires any component that calls useSearchParams() to be wrapped
// in a Suspense boundary, or the page fails to prerender at build time
// ("useSearchParams() should be wrapped in a suspense boundary").
export default function UpgradePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <UpgradeForm />
    </Suspense>
  )
}

function UpgradeForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { ready, canPurchase } = usePurchaseUi()
  useEffect(() => {
    if (ready && !canPurchase) router.replace('/subscription')
  }, [ready, canPurchase, router])
  const tierParam = searchParams.get('tier')
  const billingParam = searchParams.get('billing')

  const { user, isLoading: authLoading } = useAuth()
  const { families, isLoading: familiesLoading } = useFamilies()

  const primaryFamily = families?.[0]

  // Promo codes are for new subscriptions only, so a family already paying
  // gets no field. A code from a link (?promo=, remembered by
  // SourceCapture) is filled in.
  const { subscription, isLoading: subscriptionLoading } = useSubscription(primaryFamily?.id || null)
  const alreadyPaying = !!subscription && subscription.tier !== 'FREE' && (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE')
  // A family paying through Stripe starts on its own plan, so Continue
  // without a ?tier= never switches it to another one.
  const currentPlan: CurrentPlan = alreadyPaying && subscription.stripeBilled
    ? { tier: subscription.tier as PaidTierKey, billing: subscription.billingCycle }
    : null
  const currentKey = currentPlan ? `${currentPlan.tier}/${currentPlan.billing}` : ''
  const cancelPending = !!subscription && (subscription.cancelAtPeriodEnd || !!subscription.cancelAt)

  const [selectedTier, setSelectedTier] = useState<PaidTierKey>(() => parseUpgradeParams(tierParam, billingParam).tier)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(() => parseUpgradeParams(tierParam, billingParam).billing)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmingDowngrade, setConfirmingDowngrade] = useState(false)

  // A new ?tier=/&billing= (e.g. navigating here again), or the family's plan
  // arriving, resets the selection.
  useEffect(() => {
    const [t, b] = currentKey.split('/')
    const p = parseUpgradeParams(tierParam, billingParam, currentKey ? { tier: t as PaidTierKey, billing: b as BillingCycle } : null)
    setSelectedTier(p.tier)
    setBillingCycle(p.billing)
  }, [tierParam, billingParam, currentKey])

  const tier = tiers[selectedTier] ?? tiers.PREMIUM
  const change = planChange(currentPlan, { tier: selectedTier, billing: billingCycle }, cancelPending)
  const copy = upgradePageCopy(change, tier.name, billingCycle)
  const linkPromo = useSyncExternalStore(noSubscribe, () => searchParams.get('promo') || storedPromoCode(), () => null)
  const [promoTyped, setPromoTyped] = useState<string | null>(null)
  const promoInput = (promoTyped ?? linkPromo ?? '').toUpperCase()
  const [promo, setPromo] = useState<{ code: string; description: string; discount: PromoDiscount; tier: PaidTierKey; billing: BillingCycle } | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)
  // A code checked for another plan or billing cycle isn't shown as applied.
  const appliedPromo = promo && promo.tier === selectedTier && promo.billing === billingCycle && promo.code === promoInput ? promo : null

  if (!ready || !canPurchase) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="h-8 w-8 text-muted-foreground" />
      </div>
    )
  }

  if (!authLoading && !familiesLoading && primaryFamily && user && primaryFamily.ownerId !== user.id) {
    return (
      <div className="py-8">
        <Card>
          <CardHeader>
            <CardTitle>Only the account holder can change the plan</CardTitle>
            <CardDescription>
              Since you were invited to this family, you cannot upgrade or downgrade its subscription. Please ask the account holder to make the change.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline"><Link href="/subscription"><ArrowLeft className="h-4 w-4 mr-2" />Back to Subscription</Link></Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  // Safety check - if tier is somehow undefined, show loading state
  if (!tier) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="h-8 w-8 text-muted-foreground" />
      </div>
    )
  }

  const summary = orderSummaryCents(selectedTier, billingCycle)
  const promoOffCents = appliedPromo ? discountCents(appliedPromo.discount, summary.totalCents) : 0
  const taxNote = priceTaxNote()

  const applyPromo = async () => {
    const code = promoInput.trim()
    if (!code) return
    setPromoChecking(true)
    setPromoError(null)
    try {
      const res = await authFetch('/api/subscription/promo-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, tier: selectedTier, billingCycle }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setPromo({ code: data.data.code, description: data.data.description, discount: data.data.discount, tier: selectedTier, billing: billingCycle })
        setPromoTyped(data.data.code)
      } else {
        setPromo(null)
        setPromoError(data.error || "That promo code isn't valid.")
      }
    } catch {
      setPromoError("Couldn't check that code. Try again.")
    } finally {
      setPromoChecking(false)
    }
  }

  // Redirects to Stripe Checkout. Stripe collects and stores the card
  // details directly on its hosted page — no payment data is ever
  // handled by or sent to our own backend.
  const handleCheckout = async (confirmDowngrade = false) => {
    if (!primaryFamily?.id) {
      toast.error('No family found')
      return
    }
    if (change === 'same') {
      toast.info('You are already on this plan')
      return
    }
    if (change === 'downgrade' && !confirmDowngrade) {
      setConfirmingDowngrade(true)
      return
    }

    setConfirmingDowngrade(false)
    setIsSubmitting(true)

    try {
      const res = await authFetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId: primaryFamily.id,
          tier: selectedTier,
          billingCycle,
          // Checked again on the server; a bad code stops here with its reason.
          ...(!alreadyPaying && promoInput.trim() ? { promoCode: promoInput.trim() } : {}),
          ...(confirmDowngrade ? { confirmDowngrade: true } : {}),
        }),
      })

      const data = await res.json()

      if (res.ok && data.url) {
        window.location.href = data.url
      } else if (res.ok && data.alreadyOnPlan) {
        toast.info(data.message || 'You are already on this plan')
        setIsSubmitting(false)
      } else if (data.code === 'CONFIRM_DOWNGRADE') {
        setConfirmingDowngrade(true)
        setIsSubmitting(false)
      } else {
        toast.error(data.error || 'Failed to start checkout')
        setIsSubmitting(false)
      }
    } catch {
      toast.error('Something went wrong')
      setIsSubmitting(false)
    }
  }

  if (authLoading || familiesLoading || (primaryFamily && subscriptionLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const choice = (active: boolean) =>
    cn(
      'rounded-lg border-2 p-3 text-left transition-all',
      active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
    )

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      <div className="flex items-center gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" asChild className="h-9 w-9 shrink-0">
          <Link href="/subscription" aria-label="Back to subscription">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{copy.title}</h1>
          <FamilyNameTag name={primaryFamily?.name} className="mt-1" />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div>
                <p className="mb-2 text-sm font-semibold">Plan</p>
                <div className="grid grid-cols-2 gap-3">
                  {(Object.entries(tiers) as [keyof typeof tiers, typeof tiers.PREMIUM][]).map(([key, t]) => (
                    <button key={key} type="button" onClick={() => setSelectedTier(key)} className={choice(selectedTier === key)}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{t.name}</span>
                        {selectedTier === key && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                      <p className="mt-2 text-lg font-bold">
                        {displayPrice(SUBSCRIPTION_TIERS[key], billingCycle).main}
                        <span className="text-xs font-normal text-muted-foreground">{billingCycle === 'annual' ? '/yr' : '/mo'}</span>
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">Billing</p>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setBillingCycle('monthly')} className={choice(billingCycle === 'monthly')}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Monthly</span>
                      {billingCycle === 'monthly' && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="mt-1 text-xl font-bold">${tier.price.monthly.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Billed monthly</p>
                  </button>
                  <button type="button" onClick={() => setBillingCycle('annual')} className={choice(billingCycle === 'annual')}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Annual</span>
                      {billingCycle === 'annual' ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <Badge className="bg-green-500 text-[10px]">Save {annualSavingsPercent(SUBSCRIPTION_TIERS[selectedTier])}%</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xl font-bold">${tier.price.annual.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{displayPrice(SUBSCRIPTION_TIERS[selectedTier], 'annual').sub}</p>
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {currentPlan
                    ? 'Plan changes use the card already on file with Stripe. We never see or store your card number.'
                    : <>You&apos;ll enter your card on Stripe&apos;s secure checkout in the next step. We never see or store your card number.</>}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="lg:sticky lg:top-4">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </span>
                <div>
                  <p className="font-semibold">{tier.name}</p>
                  <p className="text-xs text-muted-foreground">{billingCycle === 'annual' ? 'Annual' : 'Monthly'} billing</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {tier.name} plan{billingCycle === 'annual' ? ` (12 × ${centsToDollars(SUBSCRIPTION_TIERS[selectedTier].priceMonthlyCents)})` : ''}
                  </span>
                  <span>{centsToDollars(summary.listCents)}</span>
                </div>
                {summary.discountCents > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Annual discount</span>
                    <span>-{centsToDollars(summary.discountCents)}</span>
                  </div>
                )}
                {appliedPromo && promoOffCents > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Promo {appliedPromo.code}</span>
                    <span>-{centsToDollars(promoOffCents)}</span>
                  </div>
                )}
              </div>

              {!alreadyPaying && (
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      aria-label="Promo code"
                      placeholder="Promo code"
                      value={promoInput}
                      onChange={(e) => { setPromoTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')); setPromoError(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyPromo() }}
                      maxLength={30}
                      className="h-9 font-mono"
                    />
                    <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={applyPromo} disabled={!promoInput.trim() || promoChecking}>
                      {promoChecking ? <Spinner className="h-4 w-4" /> : 'Apply'}
                    </Button>
                  </div>
                  {appliedPromo && <p className="text-xs text-green-600">{describeDiscount(appliedPromo.discount)}</p>}
                  {promoError && <p className="text-xs text-destructive">{promoError}</p>}
                </div>
              )}

              <Separator />

              <div className="flex justify-between text-lg font-semibold">
                <span>{appliedPromo ? 'Due today' : 'Total'}</span>
                <span>{centsToDollars(summary.totalCents - promoOffCents)}</span>
              </div>
              {taxNote && <p className="-mt-2 text-right text-xs text-muted-foreground">{taxNote}</p>}
              {billingCycle === 'annual' && (
                <p className="text-center text-xs text-muted-foreground">That&apos;s {displayPrice(SUBSCRIPTION_TIERS[selectedTier], 'annual').sub}</p>
              )}

              <Button
                className="w-full"
                size="lg"
                variant={change === 'downgrade' ? 'outline' : 'default'}
                onClick={() => handleCheckout()}
                disabled={isSubmitting || change === 'same'}
              >
                {isSubmitting ? <Spinner className="mr-2 h-4 w-4" /> : change === 'same' ? <Check className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
                {copy.button}
              </Button>
              {change === 'downgrade' && currentPlan && (
                <p className="text-center text-xs text-muted-foreground">{downgradeNotice(tiers[currentPlan.tier].name, tier.name)}</p>
              )}

              <ul className="space-y-1 border-t pt-3">
                {tier.features.slice(0, 5).map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmingDowngrade} onOpenChange={(open) => { if (!open && !isSubmitting) setConfirmingDowngrade(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {tier.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {downgradeNotice(currentPlan ? tiers[currentPlan.tier].name : 'your current plan', tier.name)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Keep my plan</AlertDialogCancel>
            <AlertDialogAction disabled={isSubmitting} onClick={() => handleCheckout(true)}>
              Switch to {tier.name} now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
