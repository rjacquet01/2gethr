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
  Crown,
  Lock,
  Shield,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUBSCRIPTION_TIERS } from '@/lib/subscription-tiers'

// Sourced from lib/subscription-tiers.ts rather than a hand-typed copy, so
// this checkout page can't go out of sync with what /pricing and
// /subscription advertise (this page's numbers happened to already match
// when this change was made, but the same duplication is what let the
// public pricing page drift to $2.99/$4.99 while this one said $3.99/$7.99).
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
    // PREMIUM or BASIC both map to the Basic plan (PREMIUM key)
    return 'PREMIUM'
  }

  const { user, isLoading: authLoading } = useAuth()
  const { families, isLoading: familiesLoading } = useFamilies()

  const [selectedTier, setSelectedTier] = useState<'PREMIUM' | 'PREMIUM_PLUS'>(getTierKey(rawTierParam))
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const primaryFamily = families?.[0]
  const tier = tiers[selectedTier] ?? tiers.PREMIUM

  if (!ready || !canPurchase) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="h-8 w-8 text-muted-foreground" />
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

  useEffect(() => {
    if (rawTierParam) {
      setSelectedTier(getTierKey(rawTierParam))
    }
  }, [rawTierParam])

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

  return (
    <div className="container max-w-4xl py-8 space-y-8">
      {/* Back Button */}
      <Button variant="ghost" size="sm" asChild>
        <Link href="/subscription">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Subscription
        </Link>
      </Button>

      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center p-3 rounded-full bg-primary/10 mb-4">
          <Crown className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Upgrade to {tier.name}</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Unlock premium features and give your family the best protection
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-8">
        {/* Left Column - Plan Selection */}
        <div className="lg:col-span-3 space-y-6">
          {/* Plan Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Select Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {(Object.entries(tiers) as [keyof typeof tiers, typeof tiers.PREMIUM][]).map(([key, t]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedTier(key)}
                    className={cn(
                      "p-4 rounded-lg border-2 text-left transition-all",
                      selectedTier === key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">{t.name}</span>
                      {selectedTier === key && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                    <p className="text-lg font-bold mt-2">
                      ${billingCycle === 'annual' ? (t.price.annual / 12).toFixed(2) : t.price.monthly}
                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Billing Cycle */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Billing Cycle</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setBillingCycle('monthly')}
                  className={cn(
                    "p-4 rounded-lg border-2 text-left transition-all",
                    billingCycle === 'monthly'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">Monthly</span>
                    {billingCycle === 'monthly' && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="text-2xl font-bold">${tier.price.monthly}</p>
                  <p className="text-sm text-muted-foreground">Billed monthly</p>
                </button>

                <button
                  onClick={() => setBillingCycle('annual')}
                  className={cn(
                    "p-4 rounded-lg border-2 text-left transition-all relative overflow-hidden",
                    billingCycle === 'annual'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <Badge className="absolute top-2 right-2 bg-green-500">Save up to 33%</Badge>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">Annual</span>
                    {billingCycle === 'annual' && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="text-2xl font-bold">${tier.price.annual}</p>
                  <p className="text-sm text-muted-foreground">
                    ${(tier.price.annual / 12).toFixed(2)}/mo billed yearly
                  </p>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Payment info card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Payment
              </CardTitle>
              <CardDescription>
                You&apos;ll enter your card details on Stripe&apos;s secure checkout page in the next step.
                We never see or store your card number.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-lg bg-muted/50 border flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>Payments are processed by Stripe, a PCI Level 1 certified payment provider.</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Order Summary */}
        <div className="lg:col-span-2">
          <Card className="sticky top-8">
            <CardHeader>
              <CardTitle className="text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{tier.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {billingCycle === 'annual' ? 'Annual' : 'Monthly'} billing
                  </p>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tier.name} Plan</span>
                  <span>${price.toFixed(2)}</span>
                </div>
                {billingCycle === 'annual' && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Annual discount</span>
                    <span>-${((tier.price.monthly * 12) - tier.price.annual).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex justify-between font-semibold text-lg">
                <span>Total</span>
                <span>${price.toFixed(2)}</span>
              </div>

              {billingCycle === 'annual' && (
                <p className="text-xs text-muted-foreground text-center">
                  That&apos;s just ${monthlyEquivalent}/month
                </p>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleCheckout}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Spinner className="h-4 w-4 mr-2" />
                ) : (
                  <Lock className="h-4 w-4 mr-2" />
                )}
                Continue to Secure Checkout
              </Button>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Shield className="h-3 w-3" />
                <span>Secure payment processing by Stripe</span>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-start gap-3 pt-0">
              <Separator />
              <div className="space-y-2 w-full">
                <p className="text-xs font-medium">What&apos;s included:</p>
                <ul className="space-y-1">
                  {tier.features.slice(0, 4).map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Check className="h-3 w-3 text-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
