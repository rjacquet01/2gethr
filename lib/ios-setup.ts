// iPhone and iPad have no Togethr app: people use mytogethr.com, and Apple
// only delivers web push notifications to a site added to the Home Screen
// (iOS 16.4+) and opened from there. Links tapped inside Instagram, TikTok
// and other apps open in that app's own browser, which can't add to the Home
// Screen at all. This works out which of those cases a visitor is in; the
// steps are on /iphone (app/iphone/page.tsx).

export type IosSetupState =
  | 'not-ios'
  /** Inside Instagram, TikTok, Facebook...: open in Safari first. */
  | 'in-app'
  /** Safari (or another iOS browser), not added to the Home Screen yet. */
  | 'browser'
  /** Added to the Home Screen, but iOS is older than 16.4: no notifications. */
  | 'old-ios'
  /** Opened from the Home Screen icon. */
  | 'installed'

const IN_APP_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|musical_ly|BytedanceWebview|TikTok|Snapchat|Twitter|LinkedInApp|Pinterest|GSA\/|Line\//

/** The in-app browser's name, for "Open in Safari" wording; null when it isn't one. */
export function inAppBrowserName(ua: string): string | null {
  if (/Instagram/.test(ua)) return 'Instagram'
  if (/musical_ly|BytedanceWebview|TikTok/.test(ua)) return 'TikTok'
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'Facebook'
  if (/Snapchat/.test(ua)) return 'Snapchat'
  if (IN_APP_BROWSER.test(ua)) return 'this app'
  return null
}

/** iPhone/iPad, including iPadOS which reports itself as a Mac (touchPoints > 1). */
export function isIos(ua: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
}

/** [major, minor] from "OS 17_4 like Mac OS X" or "Version/17.4"; null if unknown. */
export function iosVersion(ua: string): [number, number] | null {
  const m = ua.match(/OS (\d+)[_.](\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2])] : null
}

export function iosSupportsWebPush(ua: string): boolean {
  const v = iosVersion(ua)
  if (!v) return true // unknown: don't warn
  return v[0] > 16 || (v[0] === 16 && v[1] >= 4)
}

export function iosSetupState(opts: { ua: string; maxTouchPoints?: number; standalone: boolean }): IosSetupState {
  if (!isIos(opts.ua, opts.maxTouchPoints)) return 'not-ios'
  if (opts.standalone) return iosSupportsWebPush(opts.ua) ? 'installed' : 'old-ios'
  if (inAppBrowserName(opts.ua)) return 'in-app'
  return 'browser'
}

/** The state for this browser (client only). */
export function currentIosSetupState(): IosSetupState {
  if (typeof navigator === 'undefined') return 'not-ios'
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true)
  return iosSetupState({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone })
}
