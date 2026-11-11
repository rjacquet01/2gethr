'use client'

import Link from 'next/link'
import { Smartphone } from 'lucide-react'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'
import { cn } from '@/lib/utils'

/** The Togethr listing on Google Play. */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.togethrapp.mobile'

/**
 * Set NEXT_PUBLIC_PLAY_STORE_LIVE=true in Vercel once the listing is public.
 * Until then only a "Coming soon" pill shows, so no dead link goes live.
 */
export const PLAY_STORE_LIVE = process.env.NEXT_PUBLIC_PLAY_STORE_LIVE === 'true'

/**
 * Closed test (before the listing is public): the Google Group set as the
 * tester list in Play Console. While it's set and the listing isn't live, the
 * homepage shows the "Join the Android beta" steps. null hides them.
 * People join the group and opt in on Google's own pages; nothing about them
 * passes through Togethr.
 */
export const BETA_GROUP_URL: string | null = null
/** Google's opt-in page for the test; works once someone is in the group. */
export const BETA_OPT_IN_URL = 'https://play.google.com/apps/testing/com.togethrapp.mobile'
export const BETA_OPEN = !PLAY_STORE_LIVE && BETA_GROUP_URL !== null

// OFFICIAL BADGE: Google's own English "Get it on Google Play" badge, downloaded
// unmodified from play.google.com/intl/en_us/badges. Don't recolor, edit or
// redraw it, and keep Google's clear space around it.
const OFFICIAL_BADGE_SRC: string | null = '/badges/google-play-badge.png'

/** True on the website once the browser has checked it isn't the Android app. */
function useOnWebsite(): boolean {
  const { ready, isAndroidApp } = usePurchaseUi()
  return ready && !isAndroidApp
}

/** "Get it on Google Play" (or "Coming soon") for the website; hidden inside the Android app. */
export function PlayStoreBadge({ className }: { className?: string }) {
  const onWebsite = useOnWebsite()
  if (!onWebsite) return null

  if (BETA_OPEN) {
    return (
      <Link
        href="/#android-beta"
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted',
          className
        )}
      >
        <Smartphone className="h-4 w-4" aria-hidden="true" />
        Join the Android beta
      </Link>
    )
  }

  if (!PLAY_STORE_LIVE) {
    return (
      <span
        aria-disabled="true"
        className={cn(
          'inline-flex select-none items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-2 text-sm text-muted-foreground',
          className
        )}
      >
        <Smartphone className="h-4 w-4" aria-hidden="true" />
        Coming soon to Google Play
      </span>
    )
  }

  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90',
        OFFICIAL_BADGE_SRC && 'bg-transparent p-0',
        className
      )}
    >
      {OFFICIAL_BADGE_SRC ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={OFFICIAL_BADGE_SRC} alt="Get it on Google Play" className="h-12 w-auto" />
      ) : (
        <>
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          Get it on Google Play
        </>
      )}
    </a>
  )
}

/** "Also available on Android" line for the website, behind the same flag. */
export function AndroidAvailableNote({ className }: { className?: string }) {
  const onWebsite = useOnWebsite()
  if (!onWebsite || !PLAY_STORE_LIVE) return null
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      Also available on Android.{' '}
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
        Get it on Google Play
      </a>
    </p>
  )
}

/** Homepage steps to join the closed test on Google Play; website only, while BETA_OPEN. */
export function AndroidBetaInvite() {
  const onWebsite = useOnWebsite()
  if (!onWebsite || !BETA_OPEN || !BETA_GROUP_URL) return null
  const link = 'font-medium text-primary underline underline-offset-4 hover:opacity-80'
  return (
    <section id="android-beta" className="scroll-mt-20 py-12 sm:py-16">
      <div className="container mx-auto max-w-2xl px-4">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="mb-2 text-2xl font-bold text-foreground sm:text-3xl">Help test the Android app</h2>
          <p className="mb-6 text-muted-foreground text-pretty">
            Togethr for Android is in a small beta on Google Play. Use the Google account that&apos;s on your Android phone for every step.
          </p>
          <ol className="mb-6 space-y-4">
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">1</span>
              <p className="text-foreground">
                <a href={BETA_GROUP_URL} target="_blank" rel="noopener noreferrer" className={link}>Join the Togethr testers group</a> on Google Groups.
              </p>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">2</span>
              <p className="text-foreground">
                <a href={BETA_OPT_IN_URL} target="_blank" rel="noopener noreferrer" className={link}>Open the tester page</a> and tap <span className="font-medium">Become a tester</span>.
              </p>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">3</span>
              <p className="text-foreground">Install Togethr from Google Play. It can take a few minutes to show up after step 2.</p>
            </li>
          </ol>
          <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="inline-block">
            {OFFICIAL_BADGE_SRC ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={OFFICIAL_BADGE_SRC} alt="Get it on Google Play" className="h-12 w-auto" />
            ) : (
              <span className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
                <Smartphone className="h-4 w-4" aria-hidden="true" />
                Get it on Google Play
              </span>
            )}
          </a>
          <p className="mt-4 text-sm text-muted-foreground">
            Please keep the app installed for at least two weeks, and tell us what you think from Support in the app.
          </p>
        </div>
      </div>
    </section>
  )
}
