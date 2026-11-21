import type { Metadata } from 'next'
import Link from 'next/link'
import { AndroidBetaInvite } from '@/components/play-store-badge'

// The page behind mytogethr.com/beta (posts and bios). The tester steps are the
// first thing on it, so nobody has to scroll past the homepage to find them.
export const metadata: Metadata = {
  title: 'Join the Togethr Android beta',
  description: 'Help test Togethr on Android. Three quick steps, and every new family gets a free 30-day Premium trial.',
  alternates: { canonical: '/beta' },
}

export default function BetaPage() {
  return (
    <main className="min-h-screen bg-background">
      <AndroidBetaInvite />
      <p className="pb-12 text-center text-sm text-muted-foreground">
        Just want to look around?{' '}
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">See Togethr on the web</Link>
      </p>
    </main>
  )
}
