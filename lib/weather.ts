// Daily forecast for the calendar, from one of two providers:
// - Open-Meteo: with OPEN_METEO_API_KEY set (commercial plan) the customer
//   endpoint; without it the free endpoint, which is for non-commercial use,
//   so it is only a last resort.
// - The US National Weather Service (api.weather.gov): free, US only.
// fetchForecast decides the order. The key stays server-side: it is never
// logged and never appears in a response or error message.

export interface DayForecast {
  code: number
  hi: number
  lo: number
  rain: number
  wind: number
}

export type ForecastSource = "open-meteo" | "nws"

export interface Forecast {
  source: ForecastSource
  days: Record<string, DayForecast>
}

const QUERY =
  "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max" +
  "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=16"

const CACHE = { next: { revalidate: 1800 } }
const TIMEOUT_MS = 8000
export const NWS_USER_AGENT = "Togethr (support@mytogethr.com)"

/** Coordinates rounded to 2 decimals (about 1 km): what every provider gets. */
const round = (n: number) => n.toFixed(2)

function openMeteoUrl(lat: number, lng: number, key: string | undefined): string {
  const base = key ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast"
  return `${base}?latitude=${round(lat)}&longitude=${round(lng)}` + QUERY + (key ? `&apikey=${encodeURIComponent(key)}` : "")
}

/** Open-Meteo forecast URL: the keyed endpoint when OPEN_METEO_API_KEY is set. */
export function forecastUrl(lat: number, lng: number): string {
  return openMeteoUrl(lat, lng, process.env.OPEN_METEO_API_KEY || undefined)
}

/** Remove the key from any text before it is logged. */
export function redactKey(text: string): string {
  const key = process.env.OPEN_METEO_API_KEY
  if (!key) return text
  return text.split(key).join("[redacted]").split(encodeURIComponent(key)).join("[redacted]")
}

async function openMeteo(lat: number, lng: number, key: string | undefined): Promise<Record<string, DayForecast>> {
  let res: Response
  try {
    res = await fetch(openMeteoUrl(lat, lng, key), { ...CACHE, signal: AbortSignal.timeout(TIMEOUT_MS) } as RequestInit)
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

/* --------------------------- National Weather Service --------------------------- */

/** The location is outside NWS coverage (its /points lookup answered 404). */
export class NwsNotCovered extends Error {
  constructor() {
    super("nws: location not covered")
  }
}

async function nwsGet(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      ...CACHE,
      headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit)
  } catch (e) {
    throw new Error(`nws request failed: ${redactKey(String((e as Error)?.message ?? e))}`)
  }
}

/** WMO-style code (what weatherEmoji/weatherLabel use) for an NWS shortForecast. */
export function nwsCode(shortForecast: string | null | undefined): number {
  const t = String(shortForecast || "").toLowerCase()
  if (/thunder|t-storm|tstorm/.test(t)) return 95
  if (/snow|flurr|sleet|blizzard|ice pellets/.test(t)) return 71
  if (/shower/.test(t)) return 80
  if (/drizzle/.test(t)) return 51
  if (/rain/.test(t)) return 61
  if (/fog|haze|mist|smoke/.test(t)) return 45
  if (/partly|mostly sunny|mostly clear/.test(t)) return 2
  if (/cloudy|overcast/.test(t)) return 3
  if (/sunny|clear|fair/.test(t)) return 0
  return 3
}

/** Largest number in an NWS windSpeed ("10 to 15 mph" -> 15, "5 mph" -> 5). */
export function nwsWind(windSpeed: string | null | undefined): number {
  const nums = String(windSpeed || "").match(/\d+(\.\d+)?/g)
  return nums ? Math.round(Math.max(...nums.map(Number))) : 0
}

interface NwsPeriod {
  startTime: string
  isDaytime: boolean
  temperature: number
  temperatureUnit?: string
  probabilityOfPrecipitation?: { value: number | null } | null
  windSpeed?: string
  shortForecast?: string
}

/** yyyy-MM-dd of a period's start in the place's time zone. */
function localDate(startTime: string, timeZone: string | undefined): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startTime))
    } catch {
      // unknown zone: the period's own local offset below
    }
  }
  return startTime.slice(0, 10)
}

/** Shape NWS daily periods (day + night) into DayForecast by local date. */
export function mapNwsPeriods(periods: NwsPeriod[], timeZone?: string): Record<string, DayForecast> {
  const byDate = new Map<string, NwsPeriod[]>()
  for (const p of periods || []) {
    if (!p?.startTime || typeof p.temperature !== "number") continue
    const date = localDate(p.startTime, timeZone)
    byDate.set(date, [...(byDate.get(date) || []), p])
  }
  const f = (p: NwsPeriod) => (p.temperatureUnit === "C" ? p.temperature * 9 / 5 + 32 : p.temperature)
  const days: Record<string, DayForecast> = {}
  for (const [date, ps] of byDate) {
    const temps = ps.map(f)
    const day = ps.find((p) => p.isDaytime)
    const night = ps.find((p) => !p.isDaytime)
    days[date] = {
      code: nwsCode((day || ps[0]).shortForecast),
      hi: Math.round(day ? f(day) : Math.max(...temps)),
      lo: Math.round(night ? f(night) : Math.min(...temps)),
      rain: Math.max(...ps.map((p) => p.probabilityOfPrecipitation?.value ?? 0)),
      wind: Math.max(...ps.map((p) => nwsWind(p.windSpeed))),
    }
  }
  return days
}

/** About 7 days from api.weather.gov. Throws NwsNotCovered outside the US. */
export async function fetchNwsForecast(lat: number, lng: number): Promise<Record<string, DayForecast>> {
  const points = await nwsGet(`https://api.weather.gov/points/${round(lat)},${round(lng)}`)
  if (points.status === 404) throw new NwsNotCovered()
  if (!points.ok) throw new Error(`nws points ${points.status}`)
  const meta = await points.json()
  const forecastLink = meta?.properties?.forecast
  if (typeof forecastLink !== "string" || !forecastLink.startsWith("https://api.weather.gov/")) {
    throw new Error("nws: no forecast link")
  }
  const res = await nwsGet(forecastLink)
  if (!res.ok) throw new Error(`nws forecast ${res.status}`)
  const j = await res.json()
  const days = mapNwsPeriods(j?.properties?.periods || [], meta?.properties?.timeZone)
  if (Object.keys(days).length === 0) throw new Error("nws: empty forecast")
  return days
}

/* ------------------------------- Provider order ------------------------------- */

/**
 * The forecast and which provider answered. With an Open-Meteo key: Open-Meteo,
 * then NWS if it fails. Without one: NWS, then (outside the US or if NWS
 * fails) the free Open-Meteo endpoint as a last resort, with a warning.
 * Every error is key-free. Cached 30 minutes per provider URL.
 */
export async function fetchForecast(lat: number, lng: number): Promise<Forecast> {
  const key = process.env.OPEN_METEO_API_KEY || undefined
  if (key) {
    try {
      return { source: "open-meteo", days: await openMeteo(lat, lng, key) }
    } catch (e) {
      const first = redactKey(String((e as Error)?.message ?? e))
      try {
        return { source: "nws", days: await fetchNwsForecast(lat, lng) }
      } catch (e2) {
        throw new Error(`open-meteo: ${first}; nws: ${redactKey(String((e2 as Error)?.message ?? e2))}`)
      }
    }
  }
  try {
    return { source: "nws", days: await fetchNwsForecast(lat, lng) }
  } catch (e) {
    const why = e instanceof NwsNotCovered ? "outside NWS coverage" : redactKey(String((e as Error)?.message ?? e))
    console.warn(`Weather: NWS unavailable for ${round(lat)},${round(lng)} (${why}); using the free Open-Meteo endpoint. Set OPEN_METEO_API_KEY for commercial use.`)
    return { source: "open-meteo", days: await openMeteo(lat, lng, undefined) }
  }
}
