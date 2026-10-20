// Usage: npx tsx --tsconfig tsconfig.json scripts/test-admin-tier-breakdown.ts
// Admin plan breakdown (dashboard + subscriptions page): families are counted
// by the plan the customer app gives them, trials shown separately, expired
// trials as Free. Runs through the real routes on a small in-memory database
// (lib/db __setSqlForTests). Nothing touches a real database: DATABASE_URL
// points at a closed local port.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "tier-breakdown-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "tier-breakdown-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "tier-breakdown-test-admin-secret-not-real-0123456789"
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>

const DAY = 24 * 60 * 60 * 1000
const ADMIN = "admin-1"

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const { NextRequest } = await import("next/server")
  const { getFamilyPremiumAccess } = await import("../lib/services/subscription")
  const { effectivePlan, describeTierCount, planName } = await import("../lib/admin-tier-breakdown")
  const dashboard = await import("../app/api/admin/dashboard/route")
  const subscriptionsList = await import("../app/api/admin/subscriptions/route")

  const now = Date.now()
  const at = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString()
  // created_at orders rows within a family: the newest row is the family's plan.
  const families = ["paid-premium", "trial-a", "trial-no-end", "trial-expired", "cancelled-after-paid", "no-sub", "past-due", "paid-plus", "free-row"]
  const subs: Row[] = [
    { family_id: "paid-premium", tier: "PREMIUM_PLUS", status: "ACTIVE", trial_ends_at: null, created_at: at(-40) },
    { family_id: "trial-a", tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: at(5), created_at: at(-2) },
    { family_id: "trial-no-end", tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: null, created_at: at(-1) },
    { family_id: "trial-expired", tier: "PREMIUM_PLUS", status: "TRIALING", trial_ends_at: at(-1), created_at: at(-8) },
    { family_id: "cancelled-after-paid", tier: "PREMIUM", status: "ACTIVE", trial_ends_at: null, created_at: at(-60) },
    { family_id: "cancelled-after-paid", tier: "PREMIUM", status: "CANCELLED", trial_ends_at: null, created_at: at(-10) },
    { family_id: "past-due", tier: "PREMIUM", status: "PAST_DUE", trial_ends_at: null, created_at: at(-30) },
    { family_id: "paid-plus", tier: "PREMIUM", status: "ACTIVE", trial_ends_at: null, created_at: at(-20) },
    { family_id: "free-row", tier: "FREE", status: "ACTIVE", trial_ends_at: null, created_at: at(-5) },
  ]
  const latest = (familyId: string) =>
    subs.filter((s) => s.family_id === familyId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.includes("FROM admin_users")) return v[0] === ADMIN ? [{ id: ADMIN, email: "a@example.invalid", status: "ACTIVE", mfa_enabled: true }] : []
    if (q.includes("FROM admin_roles r")) return v[0] === ADMIN ? [{ name: "SUPER_ADMIN" }] : []
    if (q.includes("SELECT DISTINCT p.key")) return []
    // The breakdown query: one row per family, its latest subscription or nulls.
    if (q.includes("FROM families f LEFT JOIN LATERAL")) {
      return families.map((id) => {
        const s = latest(id)
        return { tier: s?.tier ?? null, status: s?.status ?? null, trial_ends_at: s?.trial_ends_at ?? null }
      })
    }
    // lib/services/subscription getFamilySubscription (customer-side rule).
    if (q.startsWith("SELECT id, family_id, tier, status, current_period_start")) {
      const s = latest(v[0] as string)
      return s ? [{ id: `sub-${s.family_id}`, ...s, current_period_start: null, current_period_end: null, cancel_at_period_end: false }] : []
    }
    if (q.includes("FROM admin_action_logs al")) return []
    if (q.startsWith("SELECT s.*")) return []
    return [{ total: "0" }] // other dashboard counters are not under test
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const token = await generateAdminAccessToken({ id: ADMIN, email: "a@example.invalid", firstName: "A", lastName: "Admin", status: "ACTIVE", mfaEnabled: true, roles: ["SUPER_ADMIN"], permissions: [] } as Parameters<typeof generateAdminAccessToken>[0])
  const get = (url: string) => new NextRequest(url, { headers: { authorization: `Bearer ${token}` } })

  // 1. Every family's admin plan matches the plan the customer app gives it.
  for (const id of families) {
    const s = latest(id)
    const access = await getFamilyPremiumAccess(id)
    const plan = effectivePlan({ tier: s?.tier ?? null, status: s?.status ?? null, trial_ends_at: s?.trial_ends_at ?? null }, now)
    assert.strictEqual(plan.tier, access.tier, `${id}: admin plan ${plan.tier} vs customer ${access.tier}`)
  }
  ok("admin plan matches getFamilyPremiumAccess for every family")

  // 2. Dashboard breakdown: trials counted, kept apart from paid, expired trial is Free.
  const expected = {
    PREMIUM_PLUS: { paid: 1, trial: 2 },
    PREMIUM: { paid: 1, trial: 0 },
    FREE: { paid: 5, trial: 0 },
  }
  const dash = await dashboard.GET(get("http://localhost/api/admin/dashboard"))
  assert.strictEqual(dash.status, 200)
  const dashBody = await dash.json()
  assert.deepStrictEqual(dashBody.subscriptions.byTier, expected)
  ok("dashboard byTier: Premium 1 paid + 2 trial, Plus 1 paid, Free 5 (incl. expired trial, cancelled, past due, no row)")

  // 3. Subscriptions page stats use the same rule.
  const list = await subscriptionsList.GET(get("http://localhost/api/admin/subscriptions"))
  assert.strictEqual(list.status, 200)
  assert.deepStrictEqual((await list.json()).stats.byTier, expected)
  ok("subscriptions page byTier matches the dashboard")

  // 4. Labels: customer-facing names and readable counts.
  assert.strictEqual(planName("PREMIUM_PLUS"), "Premium")
  assert.strictEqual(planName("PREMIUM"), "Plus")
  assert.strictEqual(planName("FREE"), "Free")
  assert.strictEqual(planName(null), "Free")
  assert.strictEqual(describeTierCount("PREMIUM_PLUS", expected.PREMIUM_PLUS), "1 paid + 2 on trial")
  assert.strictEqual(describeTierCount("PREMIUM", expected.PREMIUM), "1 paid")
  assert.strictEqual(describeTierCount("PREMIUM", { paid: 0, trial: 3 }), "3 on trial")
  assert.strictEqual(describeTierCount("PREMIUM", undefined), "0")
  assert.strictEqual(describeTierCount("FREE", expected.FREE), "5")
  ok("labels: PREMIUM_PLUS=Premium, PREMIUM=Plus, counts read '1 paid + 2 on trial'")

  // 5. Unauthenticated callers get nothing.
  const anon = await dashboard.GET(new NextRequest("http://localhost/api/admin/dashboard"))
  assert.strictEqual(anon.status, 401)
  ok("dashboard refuses a request without an admin token")

  __setSqlForTests(null)
  console.log(`\nAll ${passed} admin tier breakdown checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
