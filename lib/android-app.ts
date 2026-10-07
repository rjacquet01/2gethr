import type { NextRequest } from "next/server"

// Server-side companion to hooks/use-purchase-ui.ts. The Android app sets a
// cookie; checkout/portal routes refuse those requests unless the US
// external-links program is enabled and the caller is in the US.
export function purchaseBlockedForRequest(request: NextRequest): boolean {
  if (request.cookies.get("togethr_android")?.value !== "1") return false
  const enabled = process.env.NEXT_PUBLIC_PLAY_EXTERNAL_LINKS === "true"
  const country = request.headers.get("x-vercel-ip-country")
  return !(enabled && country === "US")
}
