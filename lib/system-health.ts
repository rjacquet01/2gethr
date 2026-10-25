import { sql } from "./db"

// Launch checks for the admin System Health page and the public /api/health.
// Only says whether each setting is present (and Stripe's mode): never a value.

export type CheckState = "ok" | "warn" | "off"

export interface ServiceCheck {
  name: string
  state: CheckState
  detail: string
}

type Env = Record<string, string | undefined>

const set = (v: string | undefined) => !!v && v.trim().length > 0

export function serviceChecks(env: Env): ServiceCheck[] {
  const checks: ServiceCheck[] = []
  const stripeKey = env.STRIPE_SECRET_KEY || ""
  const stripeMode = stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_") ? "live" : set(stripeKey) ? "test" : null
  const prices = ["STRIPE_PRICE_BASIC_MONTHLY", "STRIPE_PRICE_BASIC_ANNUAL", "STRIPE_PRICE_PREMIUM_MONTHLY", "STRIPE_PRICE_PREMIUM_ANNUAL"]
  const missingPrices = prices.filter((p) => !set(env[p]))
  checks.push({
    name: "Payments (Stripe)",
    state: !stripeMode || !set(env.STRIPE_WEBHOOK_SECRET) || missingPrices.length ? "off" : stripeMode === "live" ? "ok" : "warn",
    detail: !stripeMode
      ? "No Stripe key"
      : !set(env.STRIPE_WEBHOOK_SECRET)
        ? "Webhook secret missing"
        : missingPrices.length
          ? `${missingPrices.length} plan price${missingPrices.length === 1 ? "" : "s"} missing`
          : stripeMode === "live" ? "Live mode" : "Test mode: no real charges",
  })
  checks.push({
    name: "Email (Resend)",
    state: set(env.RESEND_API_KEY) ? "ok" : "off",
    detail: set(env.RESEND_API_KEY) ? "Configured" : "No API key: no email is sent",
  })
  const vapid = set(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) && set(env.VAPID_PRIVATE_KEY)
  checks.push({ name: "Push notifications", state: vapid ? "ok" : "off", detail: vapid ? "Configured" : "VAPID keys missing" })
  const provider = (env.SMS_PROVIDER || "twilio").toLowerCase()
  const sms = provider === "telnyx"
    ? set(env.TELNYX_API_KEY) && set(env.TELNYX_FROM_NUMBER)
    : set(env.TWILIO_ACCOUNT_SID) && set(env.TWILIO_AUTH_TOKEN) && set(env.TWILIO_PHONE_NUMBER)
  checks.push({
    name: "Texts",
    state: sms ? "ok" : "off",
    detail: `${provider === "telnyx" ? "Telnyx" : "Twilio"}: ${sms ? "configured" : "not configured"}`,
  })
  checks.push({
    name: "Scheduled jobs secret",
    state: set(env.CRON_SECRET) ? "ok" : "off",
    detail: set(env.CRON_SECRET) ? "Set" : "CRON_SECRET missing: jobs are refused",
  })
  checks.push({
    name: "Board flyer storage",
    state: set(env.BLOB_READ_WRITE_TOKEN) ? "ok" : "off",
    detail: set(env.BLOB_READ_WRITE_TOKEN) ? "Configured" : "Blob token missing",
  })
  checks.push({
    name: "Data encryption key",
    state: set(env.ENCRYPTION_KEY) ? "ok" : "off",
    detail: set(env.ENCRYPTION_KEY) ? "Set" : "ENCRYPTION_KEY missing",
  })
  checks.push({
    name: "Maps",
    state: set(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) || set(env.GOOGLE_MAPS_API_KEY) ? "ok" : "warn",
    detail: set(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) || set(env.GOOGLE_MAPS_API_KEY) ? "Configured" : "No Google Maps key",
  })
  if (env.ADMIN_MFA_OPTIONAL === "true") {
    checks.push({ name: "Admin two-step sign-in", state: "warn", detail: "ADMIN_MFA_OPTIONAL is on" })
  }
  if (env.RETENTION_PURGE_DISABLED === "true") {
    checks.push({ name: "Data retention purge", state: "warn", detail: "RETENTION_PURGE_DISABLED is on" })
  }
  return checks
}

export async function databaseCheck(): Promise<{ ok: boolean; latencyMs: number | null }> {
  const started = Date.now()
  try {
    await sql`SELECT 1`
    return { ok: true, latencyMs: Date.now() - started }
  } catch (err) {
    console.error("[health] database check failed:", err instanceof Error ? err.message : err)
    return { ok: false, latencyMs: null }
  }
}
