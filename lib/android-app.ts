import type { NextRequest } from "next/server"

// Server-side companion to hooks/use-purchase-ui.ts. The Android app sets a
// cookie; checkout/portal routes refuse those requests unless the US
// external-links program is enabled and the caller is in the US.

export const ANDROID_APP_COOKIE = "togethr_android"
/** Launch-URL marker for the Android app (start URL "/?source=android-app"). */
export const ANDROID_APP_SOURCE = "android-app"

export interface AppVisitSignals {
  /** The Referer header: the app's first page load can carry android-app://<package>. */
  referer?: string | null
  /** The togethr_android cookie, set by the app's tab on every load. */
  cookie?: string | null
  /** The ?source= query parameter. */
  source?: string | null
  /** x-vercel-ip-country */
  country?: string | null
}

/** Whether this request comes from the Android app (any of the signals above). */
export function isAndroidAppVisit(s: AppVisitSignals): boolean {
  return (
    s.cookie === "1" ||
    (s.referer ?? "").startsWith("android-app://") ||
    s.source === ANDROID_APP_SOURCE
  )
}

/** Prices and purchase links must not be shown (or served) for this visit. */
export function purchaseBlockedFor(s: AppVisitSignals): boolean {
  if (!isAndroidAppVisit(s)) return false
  const enabled = process.env.NEXT_PUBLIC_PLAY_EXTERNAL_LINKS === "true"
  return !(enabled && s.country === "US")
}

export function purchaseBlockedForRequest(request: NextRequest): boolean {
  return purchaseBlockedFor({
    cookie: request.cookies.get(ANDROID_APP_COOKIE)?.value,
    referer: request.headers.get("referer"),
    source: request.nextUrl.searchParams.get("source"),
    country: request.headers.get("x-vercel-ip-country"),
  })
}

/** For server components: the same decision from next/headers. */
export async function purchaseBlockedForPage(source?: string | string[] | null): Promise<boolean> {
  const { headers, cookies } = await import("next/headers")
  const [h, c] = await Promise.all([headers(), cookies()])
  return purchaseBlockedFor({
    cookie: c.get(ANDROID_APP_COOKIE)?.value,
    referer: h.get("referer"),
    source: Array.isArray(source) ? source[0] : source,
    country: h.get("x-vercel-ip-country"),
  })
}
