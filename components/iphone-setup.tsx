'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Check, Copy, Compass, MapPin, PlusSquare, Share, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PlayStoreBadge } from '@/components/play-store-badge'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { authFetch } from '@/hooks/use-auth'
import { currentIosSetupState, inAppBrowserName, iosSupportsWebPush, type IosSetupState } from '@/lib/ios-setup'
import { cn } from '@/lib/utils'

const SITE = 'https://mytogethr.com'

const noSubscribe = () => () => {}

/** A value read from the browser; serverValue during server render and hydration. */
function useBrowserValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue)
}

function useIosState(): IosSetupState | null {
  return useBrowserValue<IosSetupState | null>(currentIosSetupState, null)
}

async function copySiteLink() {
  try {
    await navigator.clipboard.writeText(SITE)
    toast.success('Link copied. Paste it into Safari.')
  } catch {
    toast.error(`Couldn't copy. Type ${SITE.replace('https://', '')} into Safari.`)
  }
}

function Step({ n, title, current, done, children }: { n: number; title: string; current: boolean; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-xl border p-5', current && 'border-primary ring-1 ring-primary bg-primary/5')}>
      <div className="flex items-center gap-3 mb-3">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold', done ? 'bg-green-600 text-white' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
          {done ? <Check className="h-4 w-4" /> : n}
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
        {current && <span className="ml-auto text-xs font-medium text-primary">You are here</span>}
      </div>
      <div className="space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

/** The three steps on /iphone, with the visitor's current one highlighted. */
export function IphoneSetupSteps() {
  const state = useIosState()
  const appName = useBrowserValue(() => inAppBrowserName(navigator.userAgent), null)
  const pushOk = useBrowserValue(() => iosSupportsWebPush(navigator.userAgent), true)

  const installed = state === 'installed' || state === 'old-ios'

  return (
    <div className="space-y-4">
      {state === 'not-ios' && (
        <Card className="py-0">
          <CardContent className="p-5 space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><Smartphone className="h-4 w-4" /> These steps are for iPhone and iPad.</p>
            <p className="text-muted-foreground">
              On Android, use the Togethr app. On a computer, just sign in at mytogethr.com.
            </p>
            <PlayStoreBadge />
          </CardContent>
        </Card>
      )}

      {!pushOk && (
        <Card className="border-amber-500 py-0">
          <CardContent className="p-5 text-sm">
            Notifications need iOS 16.4 or later. Update your iPhone in Settings &rsaquo; General &rsaquo; Software
            Update; everything else in Togethr works now.
          </CardContent>
        </Card>
      )}

      <Step n={1} title="Open in Safari" current={state === 'in-app'} done={state === 'browser' || installed}>
        {state === 'in-app' ? (
          <p>
            You&apos;re in {appName ?? 'an app'}&apos;s built-in browser, which can&apos;t add Togethr to your Home Screen.
          </p>
        ) : (
          <p>Links opened inside Instagram, TikTok or Facebook stay in that app&apos;s browser. Togethr needs Safari.</p>
        )}
        <p className="flex items-start gap-2">
          <Compass className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Tap the <strong>&bull;&bull;&bull;</strong> or share button (usually at the top or bottom right) and choose{' '}
            <strong>Open in browser</strong> or <strong>Open in Safari</strong>.
          </span>
        </p>
        <p>No such option? Copy the link and paste it into Safari.</p>
        <Button variant="outline" size="sm" onClick={copySiteLink}>
          <Copy className="mr-2 h-4 w-4" /> Copy mytogethr.com
        </Button>
      </Step>

      <Step n={2} title="Add to Home Screen" current={state === 'browser'} done={installed}>
        <p className="flex items-start gap-2">
          <Share className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            In Safari, tap the <strong>Share</strong> button (the square with an arrow, at the bottom of the screen,
            or next to the address bar on iPad).
          </span>
        </p>
        <p className="flex items-start gap-2">
          <PlusSquare className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>. On the newest iOS
            it may be under <strong>More</strong>; keep <strong>Open as Web App</strong> switched on.
          </span>
        </p>
      </Step>

      <Step n={3} title="Open Togethr from your Home Screen and turn on notifications" current={installed}>
        <p className="flex items-start gap-2">
          <Bell className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Tap the new Togethr icon (not Safari), sign in, then go to <strong>Settings</strong> and switch on{' '}
            <strong>Push notifications</strong>. Tap <strong>Allow</strong> when your iPhone asks.
          </span>
        </p>
        {installed && (
          <Button size="sm" asChild>
            <Link href="/settings">Go to Settings</Link>
          </Button>
        )}
      </Step>

      <Card className="py-0">
        <CardContent className="p-5 text-sm space-y-2">
          <p className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4" /> Location on iPhone</p>
          <p className="text-muted-foreground">
            iPhone doesn&apos;t let websites share location in the background. Your location updates while Togethr&apos;s
            Location page is open on screen; place arrivals and departures are recorded from those updates.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// Its own component so the push hook (which checks the subscription with the
// server) only runs when this button is on screen.
function TurnOnPushButton({ onDone }: { onDone: () => void }) {
  const push = usePushNotifications()
  const turnOn = async () => {
    const ok = await push.subscribe()
    if (!ok) {
      toast.error('Notifications are off. Turn them on in iPhone Settings > Notifications > Togethr, then try again from Settings.')
      return
    }
    await authFetch('/api/user/notification-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushNotifications: true }),
    }).catch(() => null)
    toast.success('Notifications on')
    onDone()
  }
  return <Button size="sm" onClick={turnOn} disabled={push.isLoading}>Turn on</Button>
}

const DISMISS_KEY = 'togethr-iphone-setup-dismissed'
const DISMISS_DAYS = 7

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

/** What the card offers this browser, or null for no card. */
function cardOffer(): 'install' | 'push' | null {
  const state = currentIosSetupState()
  if (state === 'not-ios' || state === 'old-ios' || dismissedRecently()) return null
  if (state !== 'installed') return 'install'
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  return perm === 'default' ? 'push' : null
}

/**
 * Signed-in iPhone users: a card nudging them to add Togethr to the Home
 * Screen (in Safari), or to turn on notifications (opened from the Home
 * Screen, permission not asked yet). Hidden for a week when closed.
 */
export function IphoneSetupCard() {
  const offer = useBrowserValue(cardOffer, null)
  const [closed, setClosed] = useState(false)
  if (!offer || closed) return null
  const askPush = offer === 'push'

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* not remembered */ }
    setClosed(true)
  }

  return (
    <Card className="mb-4 border-primary/40 bg-primary/5 py-0">
      <CardContent className="flex items-start gap-3 p-4">
        {askPush ? <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> : <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
        <div className="flex-1 space-y-2 text-sm">
          {askPush ? (
            <>
              <p className="font-medium">Turn on notifications</p>
              <p className="text-muted-foreground">Get reminders, arrivals and alerts on this iPhone.</p>
              <TurnOnPushButton onDone={() => setClosed(true)} />
            </>
          ) : (
            <>
              <p className="font-medium">Get notifications on your iPhone</p>
              <p className="text-muted-foreground">
                Add Togethr to your Home Screen. It takes three taps and opens like an app.
              </p>
              <Button size="sm" asChild>
                <Link href="/iphone">Show me how</Link>
              </Button>
            </>
          )}
        </div>
        <button type="button" onClick={dismiss} aria-label="Not now" className="rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </CardContent>
    </Card>
  )
}

/**
 * On any page, inside Instagram/TikTok/... on an iPhone: a strip pointing to
 * Safari, where Togethr can be added to the Home Screen.
 */
export function InAppBrowserNotice() {
  const state = useIosState()
  const pathname = usePathname()
  if (state !== 'in-app' || pathname === '/iphone') return null
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-primary px-4 py-2 text-center text-xs text-primary-foreground">
      <Compass className="h-4 w-4 shrink-0" />
      <span>
        For notifications, open this page in Safari.{' '}
        <Link href="/iphone" className="font-semibold underline underline-offset-2">How?</Link>
      </span>
    </div>
  )
}
