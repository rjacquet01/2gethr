import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"

// Daily forecast proxy (Open-Meteo, no API key). Coordinates are rounded so
// nearby requests share a cache entry and exact addresses are not forwarded.
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
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max" +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=16"
  try {
    const res = await fetch(url, { next: { revalidate: 1800 } })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    const j = await res.json()
    const d = j.daily
    const days: Record<string, { code: number; hi: number; lo: number; rain: number; wind: number }> = {}
    ;(d?.time || []).forEach((date: string, i: number) => {
      days[date] = {
        code: d.weather_code[i],
        hi: Math.round(d.temperature_2m_max[i]),
        lo: Math.round(d.temperature_2m_min[i]),
        rain: d.precipitation_probability_max[i] ?? 0,
        wind: Math.round(d.wind_speed_10m_max[i] ?? 0),
      }
    })
    return NextResponse.json({ success: true, data: days })
  } catch (e) {
    console.error("Weather fetch failed:", e)
    return NextResponse.json({ success: false, error: "Weather unavailable" }, { status: 502 })
  }
}
