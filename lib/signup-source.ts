import { ddl } from "./schema-snapshot"

// Where a new adult came from ("tiktok", "instagram", "direct", ...), kept on
// their account so the admin dashboard can count sign-ups by channel. Taken
// from the first link that brought this browser to the site: ?ref= or
// ?utm_source= in the URL, else the referring site, else the in-app browser
// it was opened in (Instagram and TikTok often send no referrer). Never the
// full URL or referrer, only a short label (components/source-capture.tsx
// records it in the browser, app/api/auth/register stores it).

export interface SignupSource {
  source: string
  campaign?: string
}

const SLUG = /[^a-z0-9_-]+/g

/** "TikTok Bio" -> "tiktok-bio"; null if nothing usable is left. */
export function sourceSlug(value: unknown, max = 40): string | null {
  if (typeof value !== "string") return null
  const s = value.trim().toLowerCase().replace(SLUG, "-").replace(/^-+|-+$/g, "").slice(0, max)
  return s || null
}

const HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
  [/(^|\.)pinterest\.[a-z.]+$/, "pinterest"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
]

const IN_APP: Array<[RegExp, string]> = [
  [/musical_ly|BytedanceWebview|TikTok/, "tiktok"],
  [/Instagram/, "instagram"],
  [/FBAN|FBAV|FB_IAB/, "facebook"],
  [/Snapchat/, "snapchat"],
]

/**
 * The source for a landing, or null when it says nothing (a visit from our
 * own site, or no clue at all; the caller then keeps what it had or "direct").
 */
export function detectSignupSource(opts: {
  search: string
  referrer?: string
  ownHost?: string
  ua?: string
}): SignupSource | null {
  const params = new URLSearchParams(opts.search)
  const tagged = sourceSlug(params.get("ref")) ?? sourceSlug(params.get("utm_source"))
  const campaign = sourceSlug(params.get("utm_campaign"), 60) ?? undefined
  if (tagged) return campaign ? { source: tagged, campaign } : { source: tagged }
  // The Android app opens the site with ?source=android-app (or an
  // android-app:// referrer): someone who already installed it from Play.
  if (params.get("source") === "android-app" || opts.referrer?.startsWith("android-app://")) return { source: "android-app" }

  let host = ""
  try {
    host = opts.referrer ? new URL(opts.referrer).hostname.toLowerCase() : ""
  } catch {
    host = ""
  }
  const own = (opts.ownHost ?? "").toLowerCase().replace(/^www\./, "")
  if (host && own && host.replace(/^www\./, "") === own) return null
  for (const [re, name] of HOSTS) if (host && re.test(host)) return { source: name }

  for (const [re, name] of IN_APP) if (opts.ua && re.test(opts.ua)) return { source: name }

  if (host) return { source: sourceSlug(host.replace(/^www\./, "")) ?? "other" }
  return null
}

/** Re-checks what a browser sent (it is user input). */
export function cleanSignupSource(value: unknown): SignupSource | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const source = sourceSlug(v.source)
  if (!source) return null
  const campaign = sourceSlug(v.campaign, 60)
  return campaign ? { source, campaign } : { source }
}

