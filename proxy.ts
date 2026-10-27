import { NextResponse, type NextRequest } from "next/server"
import { ANDROID_APP_COOKIE, ANDROID_APP_SOURCE } from "@/lib/android-app"

// CSRF guard for the API. Session cookies are SameSite=Lax, and on top of that
// a state-changing request that a browser marks as coming from another site
// (its Origin header names a different host) is refused. Requests without an
// Origin header (servers, webhooks, the native Android app) pass through;
// each route still does its own authentication.
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return markAndroidApp(request)
  if (!UNSAFE_METHODS.has(request.method)) return NextResponse.next()
  const origin = request.headers.get("origin")
  if (!origin) return NextResponse.next()

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host")
  let originHost: string | null = null
  try {
    originHost = new URL(origin).host
  } catch {
    // "null" or a malformed value: treat as cross-site.
  }
  if (host && originHost === host) return NextResponse.next()

  return NextResponse.json({ success: false, error: "Cross-site request refused" }, { status: 403 })
}

// Pages opened by the Android app (start URL /?source=android-app, or an
// android-app:// referrer) get the togethr_android cookie from the server, so
// this page and every later one leave out prices and upgrade links from the
// first byte (lib/android-app.ts). A session cookie, readable by the page:
// hooks/use-purchase-ui.ts keeps it in step per tab.
function markAndroidApp(request: NextRequest): NextResponse {
  const fromApp =
    request.nextUrl.searchParams.get("source") === ANDROID_APP_SOURCE ||
    (request.headers.get("referer") ?? "").startsWith("android-app://")
  if (!fromApp || request.cookies.get(ANDROID_APP_COOKIE)?.value === "1") return NextResponse.next()
  // This request already counts as the app, not just the next one.
  const headers = new Headers(request.headers)
  const cookie = headers.get("cookie")
  headers.set("cookie", cookie ? `${cookie}; ${ANDROID_APP_COOKIE}=1` : `${ANDROID_APP_COOKIE}=1`)
  const res = NextResponse.next({ request: { headers } })
  res.cookies.set(ANDROID_APP_COOKIE, "1", { path: "/", sameSite: "lax", secure: true })
  return res
}

export const config = {
  matcher: [
    "/api/:path*",
    // Pages only: not Next assets, icons or files with an extension.
    "/((?!api/|_next/|icons/|.*\\.[a-zA-Z0-9]+$).*)",
  ],
}
