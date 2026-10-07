'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Check, Sparkles } from 'lucide-react'
import { Logo } from '@/components/logo'
import { cn } from '@/lib/utils'
import { listTierDefinitions } from '@/lib/subscription-tiers'

// Pulled from lib/subscription-tiers.ts (the same data the in-app
// /subscription page reads) so this public page can't drift out of sync
// with what members actually see - and are actually charged - once signed
// in, the way it previously did (this page quoted $2.99/$4.99 after Basic
// and Premium were repriced to $3.99/$7.99 everywhere else).
const tiers = listTierDefinitions().map((def) => ({
  name: def.name,
  description: def.description,
  price: { monthly: def.priceMonthlyCents / 100, annual: def.priceAnnualCents / 100 },
  features: def.featureList,
  cta: def.key === 'FREE' ? 'Get Started' : 'Start Free Trial',
  popular: def.key === 'PREMIUM_PLUS',
}))

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual')

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-50">
        <div className="container mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
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

      <main className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits your family. New members get a 14-day free Premium trial.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center gap-2 p-1 rounded-lg bg-muted">
            <button
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                billingCycle === 'monthly' 
                  ? "bg-background shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setBillingCycle('monthly')}
            >
              Monthly
            </button>
            <button
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                billingCycle === 'annual' 
                  ? "bg-background shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setBillingCycle('annual')}
            >
              Annual
              <Badge variant="secondary" className="ml-2 text-xs">Save 17%</Badge>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {tiers.map((tier) => {
            const price = billingCycle === 'monthly' ? tier.price.monthly : tier.price.annual
            const monthlyPrice = billingCycle === 'annual' && price > 0 
              ? (price / 12).toFixed(2) 
              : price.toFixed(2)
            
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
                    <span className="text-4xl font-bold">
                      ${monthlyPrice}
                    </span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  
                  {billingCycle === 'annual' && price > 0 && (
                    <p className="text-sm text-muted-foreground">
                      ${price}/year billed annually
                    </p>
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
                      {tier.price.monthly === 0 ? null : <Sparkles className="h-4 w-4 mr-2" />}
                      {tier.cta}
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>

        {/* FAQ Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">Can I change my plan later?</h3>
              <p className="text-muted-foreground">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">What happens after my trial ends?</h3>
              <p className="text-muted-foreground">
                After your 14-day Premium trial, you can choose to subscribe or continue with our Free plan. No card is needed to start the trial, so there's nothing to cancel and you won't be charged unless you choose to subscribe.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Is location sharing required?</h3>
              <p className="text-muted-foreground">
                No, location sharing is always optional and only available on Premium plans. Each family member controls their own sharing settings.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">How do I contact support?</h3>
              <p className="text-muted-foreground">
                You can reach our support team at <a href="mailto:info@nexuscmm.com" className="text-primary hover:underline">info@nexuscmm.com</a>. Premium members get 24/7 priority support.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 sm:py-8 mt-12 sm:mt-20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <Logo size="xs" />
            <div className="flex items-center gap-4 sm:gap-6 text-sm text-muted-foreground">
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <a href="mailto:info@nexuscmm.com" className="hover:text-foreground transition-colors">Contact</a>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Togethr
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
