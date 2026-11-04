'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { SUBSCRIPTION_TIERS } from '@/lib/subscription-tiers'
import { confirmationCopy } from '@/lib/upgrade-order'
import {
  CheckCircle2,
  ArrowRight,
  Home
} from 'lucide-react'

// Next.js requires any component that calls useSearchParams() to be wrapped
// in a Suspense boundary, or the page fails to prerender at build time
// ("useSearchParams() should be wrapped in a suspense boundary").
export default function ConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmationContent />
    </Suspense>
  )
}

function ConfirmationContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const tierParam = searchParams.get('tier')
  const tierName = tierParam === 'PREMIUM' || tierParam === 'PREMIUM_PLUS' ? SUBSCRIPTION_TIERS[tierParam].name : null
  const copy = confirmationCopy({ sessionId, updated: searchParams.get('updated'), tierName, change: searchParams.get('change') })

  return (
    <div className="container max-w-2xl py-16">
      <Card className="text-center">
        <CardHeader className="pb-4">
          <div className="mx-auto mb-4 p-4 rounded-full bg-green-100 dark:bg-green-900/20">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          </div>
          <CardTitle className="text-2xl">{copy.title}</CardTitle>
          <CardDescription className="text-base">
            {copy.description}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {copy.body}
          </p>

          {sessionId && (
            <div className="p-3 rounded-lg bg-muted/30 text-sm">
              <span className="text-muted-foreground">Checkout session: </span>
              <code className="font-mono text-xs">{sessionId}</code>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-center gap-4">
          <Button variant="outline" asChild>
            <Link href="/subscription">
              <Home className="h-4 w-4 mr-2" />
              View Subscription
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard">
              Go to Dashboard
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
