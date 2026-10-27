import { PricingPage } from '@/components/pricing-page'
import { purchaseBlockedForPage } from '@/lib/android-app'

// Decided per request, so the Android app never gets prices in the page
// (Google Play rules; lib/android-app.ts).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const inApp = await purchaseBlockedForPage((await searchParams).source)
  return <PricingPage serverInApp={inApp} />
}
