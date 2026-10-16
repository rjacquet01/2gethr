'use client'

import { Suspense, useState, useEffect } from 'react'
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
import { SUBSCRIPTION_TIERS, annualSavingsPercent } from '@/lib/subscription-tiers'

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
  const rawTierParam = searchParams.get('tier')?.toUpperCase()

  // Map URL params to internal tier keys
  const getTierKey = (param: string | undefined | null): 'PREMIUM' | 'PREMIUM_PLUS' => {
    if (!param) return 'PREMIUM'
    if (param === 'PREMIUM_PLUS' || param === 'PREMIUM PLUS') return 'PREMIUM_PLUS'
    // PREMIUM (or the old BASIC / new PLUS names) maps to the Plus plan (PREMIUM key)
    return 'PREMIUM'
  }

  const { user, isLoading: authLoading } = useAuth()
  const { families, isLoading: familiesLoading } = useFamilies()

  const [selectedTier, setSelectedTier] = useState<'PREMIUM' | 'PREMIUM_PLUS'>(getTierKey(rawTierParam))
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (rawTierParam) {
      setSelectedTier(getTierKey(rawTierParam))
    }
  }, [rawTierParam])

  const primaryFamily = families?.[0]
  const tier = tiers[selectedTier] ?? tiers.PREMIUM

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

  const price = billingCycle === 'annual' ? tier.price.annual : tier.price.monthly
  const monthlyEquivalent = billingCycle === 'annual' ? (tier.price.annual / 12).toFixed(2) : tier.price.monthly

  // Redirects to Stripe Checkout. Stripe collects and stores the card
  // details directly on its hosted page — no payment data is ever
  // handled by or sent to our own backend.
  const handleCheckout = async () => {
    if (!primaryFamily?.id) {
      toast.error('No family found')
      return
    }

    setIsSubmitting(true)

    try {
      const res = await authFetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId: primaryFamily.id,
          tier: selectedTier,
          billingCycle,
        }),
      })

      const data = await res.json()

      if (res.ok && data.url) {
        window.location.href = data.url
      } else {
        toast.error(data.error || 'Failed to start checkout')
        setIsSubmitting(false)
      }
    } catch {
      toast.error('Something went wrong')
      setIsSubmitting(false)
    }
  }

  if (authLoading || familiesLoading) {
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
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Upgrade to {tier.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{primaryFamily?.name}</p>
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
                        ${billingCycle === 'annual' ? (t.price.annual / 12).toFixed(2) : t.price.monthly.toFixed(2)}
                        <span className="text-xs font-normal text-muted-foreground">/mo</span>
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
                    <p className="text-xs text-muted-foreground">${(tier.price.annual / 12).toFixed(2)}/mo billed yearly · about 2 months free</p>
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  You&apos;ll enter your card on Stripe&apos;s secure checkout in the next step. We never see or store your card number.
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
                  <span className="text-muted-foreground">{tier.name} plan</span>
                  <span>${price.toFixed(2)}</span>
                </div>
                {billingCycle === 'annual' && (
                  <div className="flex justify-between text-green-600">
                    <span>Annual discount</span>
                    <span>-${(tier.price.monthly * 12 - tier.price.annual).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span>${price.toFixed(2)}</span>
              </div>
              {billingCycle === 'annual' && (
                <p className="text-center text-xs text-muted-foreground">That&apos;s just ${monthlyEquivalent}/month</p>
              )}

              <Button className="w-full" size="lg" onClick={handleCheckout} disabled={isSubmitting}>
                {isSubmitting ? <Spinner className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
                Continue to secure checkout
              </Button>

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
    </div>
  )
}
