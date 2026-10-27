'use client'

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

// OFFICIAL BADGE: download the "Get it on Google Play" badge from Google's
// badge generator, put it in public/ (e.g. public/badges/google-play-badge.png)
// and set its path here. While null, a plain brand-styled button is shown.
// Don't draw or copy Google's logo by hand.
const OFFICIAL_BADGE_SRC: string | null = null

/** True on the website once the browser has checked it isn't the Android app. */
function useOnWebsite(): boolean {
  const { ready, isAndroidApp } = usePurchaseUi()
  return ready && !isAndroidApp
}

/** "Get it on Google Play" (or "Coming soon") for the website; hidden inside the Android app. */
export function PlayStoreBadge({ className }: { className?: string }) {
  const onWebsite = useOnWebsite()
  if (!onWebsite) return null

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
