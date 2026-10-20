// Daily forecast from Open-Meteo. With OPEN_METEO_API_KEY set (commercial
// plan) the customer endpoint is used with the key; without it, the free
// endpoint as before. The key stays server-side: it is never logged and never
// appears in a response or error message.

export interface DayForecast {
  code: number
  hi: number
  lo: number
  rain: number
  wind: number
}

const QUERY =
  "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max" +
  "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=16"

/** Forecast URL for coordinates rounded to 2 decimals (about 1 km). */
export function forecastUrl(lat: number, lng: number): string {
  const key = process.env.OPEN_METEO_API_KEY
  const base = key ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast"
  return (
    `${base}?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}` +
    QUERY +
    (key ? `&apikey=${encodeURIComponent(key)}` : "")
  )
}

/** Remove the key from any text before it is logged. */
export function redactKey(text: string): string {
  const key = process.env.OPEN_METEO_API_KEY
  if (!key) return text
  return text.split(key).join("[redacted]").split(encodeURIComponent(key)).join("[redacted]")
}

/** Fetch and shape the forecast; throws a key-free error on failure. Cached 30 minutes. */
export async function fetchForecast(lat: number, lng: number): Promise<Record<string, DayForecast>> {
  let res: Response
  try {
    res = await fetch(forecastUrl(lat, lng), { next: { revalidate: 1800 } } as RequestInit)
  } catch (e) {
    throw new Error(`weather request failed: ${redactKey(String((e as Error)?.message ?? e))}`)
  }
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const j = await res.json()
  const d = j.daily
  const days: Record<string, DayForecast> = {}
  ;(d?.time || []).forEach((date: string, i: number) => {
    days[date] = {
      code: d.weather_code[i],
      hi: Math.round(d.temperature_2m_max[i]),
      lo: Math.round(d.temperature_2m_min[i]),
      rain: d.precipitation_probability_max[i] ?? 0,
      wind: Math.round(d.wind_speed_10m_max[i] ?? 0),
    }
  })
  return days
}
