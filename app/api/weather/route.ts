import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { fetchForecast, redactKey } from "@/lib/weather"

// Daily forecast proxy (Open-Meteo; lib/weather.ts picks the free or the
// keyed commercial endpoint). Coordinates are rounded so nearby requests
// share a cache entry and exact addresses are not forwarded.
export async function GET(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }
  const lat = Number(request.nextUrl.searchParams.get("lat"))
  const lng = Number(request.nextUrl.searchParams.get("lng"))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ success: false, error: "Invalid coordinates" }, { status: 400 })
  }
  try {
    const days = await fetchForecast(lat, lng)
    return NextResponse.json({ success: true, data: days })
  } catch (e) {
    console.error("Weather fetch failed:", redactKey(String((e as Error)?.message ?? e)))
    return NextResponse.json({ success: false, error: "Weather unavailable" }, { status: 502 })
  }
}
