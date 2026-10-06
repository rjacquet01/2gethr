'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { useFamilies } from '@/hooks/use-family'
import { useSubscription, useSubscriptionTiers } from '@/hooks/use-subscription'
import { authFetch } from '@/hooks/use-events'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
  Shield,
  MapPin,
  Clock,
  Users,
  AlertCircle,
  CreditCard,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getTierDefinition } from '@/lib/subscription-tiers'

export default function SubscriptionPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const { families, isLoading: familiesLoading } = useFamilies()
  const [selectedBilling, setSelectedBilling] = useState<'monthly' | 'annual'>('annual')
  const [selectedTierIndex, setSelectedTierIndex] = useState<number | null>(null)

  const primaryFamily = families?.[0]
  const { subscription, access, isLoading: subLoading, startTrial, cancelTrial } = useSubscription(primaryFamily?.id || null)
  const tiers = useSubscriptionTiers()

  const [isStartingTrial, setIsStartingTrial] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const [isCancelingTrial, setIsCancelingTrial] = useState(false)

  // Map tier names to API tier keys
  const tierNameToKey: Record<string, string> = {
    'Free': 'FREE',
    'Basic': 'PREMIUM',
    'Premium': 'PREMIUM_PLUS',
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
    setIsStartingTrial(true)
    const result = await startTrial(tier)
    setIsStartingTrial(false)

    if (result.success) {
      toast.success('Trial started! Enjoy 30 days of premium features.')
    } else {
      toast.error(result.error || 'Failed to start trial')
    }
  }

  const handleCancelTrial = async () => {
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
      <div className="container max-w-4xl py-8">
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

  return (
    <div className="container max-w-5xl py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Subscription</h1>
        <p className="text-muted-foreground mt-1">
          Manage your Togethr subscription and unlock premium features
        </p>
      </div>

      {/* Current Plan Card */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Crown className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>Current Plan</CardTitle>
                <CardDescription>
                  {primaryFamily.name}
                </CardDescription>
              </div>
            </div>
            <Badge
              variant={access.hasPremium ? "default" : "secondary"}
              className="text-sm px-3 py-1"
            >
              {formatTierName(currentTier)}
              {isTrialing && " (Trial)"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isTrialing && trialEndsAt && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 text-warning-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-sm">
                Trial ends {trialEndsAt.toLocaleDateString()} ({Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days left)
              </span>
            </div>
          )}

          {subscription?.cancelAtPeriodEnd && !isTrialing && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 text-warning-foreground">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">
                Your subscription is cancelled
                {subscription.currentPeriodEnd
                  ? ` and ends on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                  : ' and will end at the close of the billing period'}
                . You keep your premium features until then.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">
                {access.limits.maxChildren === -1 ? (
                  <span className="text-primary">Unlimited</span>
                ) : (
                  access.limits.maxChildren
                )}
              </div>
              <div className="text-xs text-muted-foreground">Max Children</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{access.limits.historyDays}</div>
              <div className="text-xs text-muted-foreground">Days History</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{access.features.length}</div>
              <div className="text-xs text-muted-foreground">Features</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">
                {access.featureFlags.locationSharing ? (
                  <Check className="h-6 w-6 mx-auto text-primary" />
                ) : (
                  <X className="h-6 w-6 mx-auto text-muted-foreground" />
                )}
              </div>
              <div className="text-xs text-muted-foreground">Location</div>
            </div>
          </div>

          {/* What's included - every gated capability, spelled out for this
              specific family's tier, not just the 4 headline stats above. */}
          <div className="pt-2">
            <p className="text-sm font-medium mb-3">What&apos;s included in {formatTierName(currentTier)}</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
              {[
                { key: 'locationSharing' as const, label: 'Real-time location sharing' },
                { key: 'geofencing' as const, label: 'Geofence alerts' },
                { key: 'smsNotifications' as const, label: 'SMS notifications' },
                { key: 'phoneAlerts' as const, label: 'Phone call alerts' },
                { key: 'customReminderTimes' as const, label: 'Custom reminder times' },
                { key: 'advancedRecurrence' as const, label: 'Advanced/complex recurring events' },
                { key: 'exportCalendar' as const, label: 'Calendar export' },
                { key: 'prioritySupport' as const, label: 'Priority support' },
              ].map(({ key, label }) => {
                const included = access.featureFlags[key]
                return (
                  <li key={key} className="flex items-center gap-2">
                    {included ? (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className={included ? '' : 'text-muted-foreground'}>{label}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </CardContent>
        {access.hasPremium && !isTrialing && (
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManageBilling}
              disabled={isCanceling}
            >
              {isCanceling ? <Spinner className="h-4 w-4 mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
              {subscription?.cancelAtPeriodEnd ? 'Resume or Manage Billing' : 'Manage Billing'}
            </Button>
            {!subscription?.cancelAtPeriodEnd && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleManageBilling}
                disabled={isCanceling}
              >
                Cancel Subscription
              </Button>
            )}
          </CardFooter>
        )}
        {isTrialing && (
          <CardFooter>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={isCancelingTrial}
                >
                  Cancel Trial
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
          </CardFooter>
        )}
      </Card>

      {/* Billing Toggle */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 p-1 rounded-lg bg-muted">
          <button
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              selectedBilling === 'monthly'
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setSelectedBilling('monthly')}
          >
            Monthly
          </button>
          <button
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              selectedBilling === 'annual'
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setSelectedBilling('annual')}
          >
            Annual
            <Badge variant="secondary" className="ml-2 text-xs">Save 17%</Badge>
          </button>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        {tiers.map((tier, index) => {
          const tierKey = tierNameToKey[tier.name] || 'FREE'
          const isCurrentTier = tierKey === access.tier
          const isPremium = tier.name === 'Premium'
          const isSelected = selectedTierIndex === index
          const price = selectedBilling === 'monthly' ? tier.price.monthly : tier.price.annual

          const handleCardClick = () => {
            if (isCurrentTier || tier.name === 'Free') return
            setSelectedTierIndex(index)
            // Navigate to upgrade page with selected tier
            router.push(`/subscription/upgrade?tier=${tierKey}&billing=${selectedBilling}`)
          }

          return (
            <Card
              key={tier.name}
              onClick={handleCardClick}
              className={cn(
                "relative overflow-hidden transition-all",
                isPremium && "border-primary shadow-lg scale-105",
                isCurrentTier && "ring-2 ring-primary",
                isSelected && "ring-2 ring-blue-500",
                !isCurrentTier && tier.name !== 'Free' && "cursor-pointer hover:shadow-lg hover:border-primary/50"
              )}
            >
              {isPremium && (
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-xs font-medium rounded-bl-lg">
                  Most Popular
                </div>
              )}

              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {tier.name}
                  {isCurrentTier && (
                    <Badge variant="outline" className="text-xs">Current</Badge>
                  )}
                </CardTitle>
                <CardDescription>{tier.description}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">
                    ${selectedBilling === 'monthly' ? price : (price / 12).toFixed(2)}
                  </span>
                  <span className="text-muted-foreground">/month</span>
                </div>

                {selectedBilling === 'annual' && price > 0 && (
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
                {isCurrentTier ? (
                  <Button className="w-full" variant="outline" disabled>
                    Current Plan
                  </Button>
                ) : tier.name === 'Free' ? (
                  <Button className="w-full" variant="outline" disabled>
                    Included
                  </Button>
                ) : !access.hasPremium && index > 0 ? (
                  <div className="space-y-2 w-full">
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStartTrial(tierKey as 'PREMIUM' | 'PREMIUM_PLUS')
                      }}
                      disabled={isStartingTrial}
                    >
                      {isStartingTrial ? (
                        <Spinner className="h-4 w-4 mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Start 30-Day Trial
                    </Button>
                    <Button
                      className="w-full"
                      variant={isPremium ? "default" : "outline"}
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/subscription/upgrade?tier=${tierKey}&billing=${selectedBilling}`)
                      }}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Upgrade Now
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    variant={isPremium ? "default" : "outline"}
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/subscription/upgrade?tier=${tierKey}&billing=${selectedBilling}`)
                    }}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {access.tier === 'PREMIUM_PLUS' && tierKey === 'PREMIUM' ? 'Downgrade' : 'Upgrade'}
                  </Button>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {/* Features Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Premium Features</CardTitle>
          <CardDescription>
            What you get with Togethr Premium
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="flex gap-4">
              <div className="p-2 rounded-lg bg-primary/10 h-fit">
                <MapPin className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="font-medium">Real-Time Location Sharing</h4>
                <p className="text-sm text-muted-foreground">
                  See where your children are in real-time with optional location sharing
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="p-2 rounded-lg bg-primary/10 h-fit">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="font-medium">Geofence Alerts</h4>
                <p className="text-sm text-muted-foreground">
                  Get notified when family members arrive or leave saved places
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="p-2 rounded-lg bg-primary/10 h-fit">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="font-medium">Unlimited Children</h4>
                <p className="text-sm text-muted-foreground">
                  Add as many children as you need to your family
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="p-2 rounded-lg bg-primary/10 h-fit">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="font-medium">Extended History</h4>
                <p className="text-sm text-muted-foreground">
                  Access up to 1 year of event and location history
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FAQ or Support */}
      <Card>
        <CardContent className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Have questions about billing?</p>
              <p className="text-sm text-muted-foreground">
                Contact our support team for help with subscriptions
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => window.open('mailto:info@nexuscmm.com', '_blank')}
          >
            Contact Support
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
