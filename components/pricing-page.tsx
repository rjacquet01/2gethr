'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Sparkles } from 'lucide-react'
import { Logo, BRAND_MOTTO } from '@/components/brand/logo'
import { BillingToggle } from '@/components/billing-toggle'
import { PlanComparisonTable } from '@/components/plan-comparison-table'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import { IN_APP_PLANS_COPY } from '@/lib/plan-limits'
import { cn } from '@/lib/utils'
import { listTierDefinitions, annualSavingsPercent, displayPrice, SUBSCRIPTION_TIERS, TRIAL_DAYS, priceTaxNote } from '@/lib/subscription-tiers'

// Pulled from lib/subscription-tiers.ts (the same data the in-app
// /subscription page reads) so this public page can't drift out of sync
// with what members actually see - and are actually charged - once signed in.
const ANNUAL_SAVINGS = annualSavingsPercent(SUBSCRIPTION_TIERS.PREMIUM)
const tiers = listTierDefinitions().map((def) => ({
  def,
  name: def.name,
  description: def.description,
  features: def.featureList,
  cta: def.key === 'FREE' ? 'Get Started' : 'Start Free Trial',
  popular: def.key === 'PREMIUM_PLUS',
}))

/** /pricing (app/pricing/page.tsx). serverInApp: the server already knows this is the Android app. */
export function PricingPage({ serverInApp = false }: { serverInApp?: boolean }) {
  // Monthly first, so the first price people see matches the home page and checkout.
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  // Google Play: no prices or plan comparison inside the Android app.
  const { ready, canPurchase } = usePurchaseUi()
  const hidePlans = ready ? !canPurchase : serverInApp

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-50">
        <div className="container mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
          <Link href="/">
            <Logo height={36} priority />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/register">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      {hidePlans ? (
      <main className="container mx-auto px-4 py-16">
        <p className="mx-auto max-w-xl text-center text-lg text-muted-foreground">{IN_APP_PLANS_COPY}</p>
      </main>
      ) : (
      <main className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits your family. New accounts get a {TRIAL_DAYS}-day free Premium trial for their family.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-12">
          <BillingToggle value={billingCycle} onChange={setBillingCycle} savingsPercent={ANNUAL_SAVINGS} />
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {tiers.map((tier) => {
            const shown = displayPrice(tier.def, billingCycle)
            const paid = tier.def.priceMonthlyCents > 0

            return (
              <Card 
                key={tier.name}
                className={cn(
                  "relative overflow-hidden transition-all",
                  tier.popular && "border-primary shadow-lg scale-105 z-10"
                )}
              >
                {tier.popular && (
                  <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-xs font-medium rounded-bl-lg">
                    Most Popular
                  </div>
                )}
                
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {tier.name}
                  </CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{shown.main}</span>
                    <span className="text-muted-foreground">{shown.unit}</span>
                  </div>
                  {paid && priceTaxNote() && <p className="-mt-3 text-xs text-muted-foreground">{priceTaxNote()}</p>}

                  {shown.sub && (
                    <p className="text-sm text-muted-foreground">{shown.sub} · about 2 months free</p>
                  )}
                  
                  <ul className="space-y-2">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                
                <CardFooter>
                  <Button 
                    className="w-full" 
                    variant={tier.popular ? "default" : "outline"}
                    asChild
                  >
                    <Link href="/register">
                      {!paid ? null : <Sparkles className="h-4 w-4 mr-2" />}
                      {tier.cta}
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>

        {/* Limits comparison */}
        <div className="mt-16 max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-6">Compare plan limits</h2>
          <PlanComparisonTable />
        </div>

        {/* FAQ Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">Can I change my plan later?</h3>
              <p className="text-muted-foreground">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect right away, and the price difference is prorated on your next bill.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">What happens after my trial ends?</h3>
              <p className="text-muted-foreground">
                After your {TRIAL_DAYS}-day Premium trial, you can choose to subscribe or continue with our Free plan. No card is needed to start the trial, so there's nothing to cancel and you won't be charged unless you choose to subscribe.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Is location sharing required?</h3>
              <p className="text-muted-foreground">
                No, location sharing is always optional. Each family member controls their own sharing settings.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">How do I contact support?</h3>
              <p className="text-muted-foreground">
                You can reach our support team at <a href="mailto:admin@mytogethr.com" className="text-primary underline underline-offset-4">admin@mytogethr.com</a>. Plus and Premium members get priority support.
              </p>
            </div>
          </div>
        </div>
      </main>
      )}

      {/* Footer */}
      <footer className="border-t border-border py-6 sm:py-8 mt-12 sm:mt-20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex flex-col items-center gap-1 sm:items-start">
              <Logo height={28} />
              <p className="text-xs text-muted-foreground">{BRAND_MOTTO}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 sm:gap-x-6 text-sm text-muted-foreground">
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <Link href="/sms-consent" className="hover:text-foreground transition-colors">SMS</Link>
              <a href="mailto:admin@mytogethr.com" className="hover:text-foreground transition-colors">Contact</a>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Togethr, LLC. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
