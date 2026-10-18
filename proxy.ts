import { NextResponse, type NextRequest } from "next/server"

// CSRF guard for the API. Session cookies are SameSite=Lax, and on top of that
// a state-changing request that a browser marks as coming from another site
// (its Origin header names a different host) is refused. Requests without an
// Origin header (servers, webhooks, the native Android app) pass through;
// each route still does its own authentication.
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function proxy(request: NextRequest) {
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

export const config = {
  matcher: "/api/:path*",
}
