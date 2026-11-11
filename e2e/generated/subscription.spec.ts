import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { signInWithState } from '../helpers/auth'

// Subscription area: the Subscription page, the upgrade (checkout) page, the
// confirmation page and the /api/subscription(s) routes. The dev server reads
// .env.local (the Neon dev branch). The signed-out checks never sign in, so
// every request there is a guest's. Every route checks the Android app and the
// signed-in user before it reads a body, calls Stripe or writes a row, so
// nothing is written and Stripe is never reached. The signed-in checks at the
// end use the saved sessions from scripts/e2e-seed.mjs and mock every call
// that would reach Stripe with page.route, so they write nothing either.

const ANDROID = { cookie: 'togethr_android=1', referer: 'android-app://com.togethrapp.mobile/' }
const FAKE_FAMILY = '00000000-0000-0000-0000-000000000000'

const PARENT_STATE = process.env.E2E_PARENT_STATE
const CHILD_STATE = process.env.E2E_CHILD_STATE
const NOFAMILY_STATE = process.env.E2E_NOFAMILY_STATE
const PARENT_FAMILY_ID = process.env.E2E_PARENT_FAMILY_ID

// Purchase routes: app visits are refused before auth, guests get a 401.
const PURCHASE_ROUTES: Array<{ path: string; body: Record<string, unknown> }> = [
  { path: '/api/subscription/checkout', body: { familyId: FAKE_FAMILY, tier: 'PREMIUM', billingCycle: 'monthly' } },
  { path: '/api/subscription/portal', body: { familyId: FAKE_FAMILY } },
  { path: '/api/subscription/promo-check', body: { code: 'WELCOME', tier: 'PREMIUM', billingCycle: 'monthly' } },
  { path: '/api/subscription/resume', body: { familyId: FAKE_FAMILY } },
]

async function postJson(request: APIRequestContext, path: string, data: unknown, headers: Record<string, string> = {}) {
  return request.post(path, { data, headers: { 'content-type': 'application/json', ...headers }, maxRedirects: 0 })
}

// The seeded family has no subscription row, so it is on Free. Another spec
// could have started a trial on it, so the page is always shown the Free
// state the API returns for a family without a row (app/api/subscriptions).
async function forceFreePlan(page: Page) {
  await page.route(/\/api\/subscriptions(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    // The test can end while this request is in flight; that must not fail the next test.
    const real = await route.fetch().catch(() => null)
    if (!real) return
    const body = await real.json().catch(() => null)
    if (!real.ok() || !body?.data) return route.fulfill({ response: real })
    if (body.data.tier === 'FREE' && body.data.status === 'ACTIVE') return route.fulfill({ response: real, json: body })
    const plans = await page.request.fetch('/api/subscriptions', { method: 'OPTIONS' })
    const free = ((await plans.json()).data.plans as Array<Record<string, unknown>>).find((p) => p.tier === 'FREE')
    const { tier: _tier, ...tierInfo } = free ?? {}
    return route.fulfill({
      response: real,
      json: {
        success: true,
        data: {
          tier: 'FREE',
          status: 'ACTIVE',
          tierInfo,
          familyId: body.data.familyId,
          isOwner: body.data.isOwner,
          trial: body.data.isOwner ? { available: true, availableAt: null } : null,
        },
      },
    })
  })
}

test.describe('purchase API as a guest', () => {
  for (const { path, body } of PURCHASE_ROUTES) {
    test(`${path}: a guest gets 401 Unauthorized`, async ({ request }) => {
      const res = await postJson(request, path, body)
      expect(res.status(), `${path} status`).toBe(401)
      expect((await res.json()).error).toBe('Unauthorized')
    })

    test(`${path}: the Android app is refused before anything else (403)`, async ({ request }) => {
      const res = await postJson(request, path, body, ANDROID)
      expect(res.status(), `${path} status`).toBe(403)
      expect((await res.json()).error).toBe('Not available in this app')
    })

    test(`${path}: an empty body from a guest is still 401, not a validation error`, async ({ request }) => {
      const res = await postJson(request, path, {})
      expect(res.status(), `${path} status`).toBe(401)
    })
  }

  test('/api/subscription/checkout: a malformed JSON body from a guest is 401, not 500', async ({ request }) => {
    const res = await request.post('/api/subscription/checkout', {
      data: '{not json',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(401)
  })
})

test.describe('retired upgrade endpoint', () => {
  test('POST /api/subscription/upgrade is gone (410) and takes no card data', async ({ request }) => {
    const res = await postJson(request, '/api/subscription/upgrade', {
      cardNumber: '4242424242424242',
      cvv: '123',
    })
    expect(res.status()).toBe(410)
    expect((await res.json()).error).toMatch(/has been retired/)
  })

  test('GET /api/subscription/upgrade is gone (410)', async ({ request }) => {
    const res = await request.get('/api/subscription/upgrade')
    expect(res.status()).toBe(410)
    expect((await res.json()).error).toMatch(/has been retired/)
  })
})

test.describe('subscriptions API as a guest', () => {
  test('GET /api/subscriptions is 401 for a guest', async ({ request }) => {
    const res = await request.get('/api/subscriptions')
    expect(res.status()).toBe(401)
    expect((await res.json()).success).toBe(false)
  })

  test('GET /api/subscriptions?familyId= is 401 for a guest, never another family\'s plan', async ({ request }) => {
    const res = await request.get(`/api/subscriptions?familyId=${FAKE_FAMILY}`)
    expect(res.status()).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.data).toBeUndefined()
  })

  test('POST /api/subscriptions/[familyId] start_trial is 401 for a guest', async ({ request }) => {
    const res = await postJson(request, `/api/subscriptions/${FAKE_FAMILY}`, { action: 'start_trial', tier: 'PREMIUM' })
    expect(res.status()).toBe(401)
    expect((await res.json()).success).toBe(false)
  })

  test('POST /api/subscriptions/[familyId] cannot grant a paid tier to a guest', async ({ request }) => {
    const res = await postJson(request, `/api/subscriptions/${FAKE_FAMILY}`, { tier: 'PREMIUM_PLUS' })
    expect(res.status()).toBe(401)
  })

  test('OPTIONS /api/subscriptions lists the three plans', async ({ request }) => {
    const res = await request.fetch('/api/subscriptions', { method: 'OPTIONS' })
    expect(res.status()).toBeLessThan(400)
    const json = await res.json()
    expect(json.success).toBe(true)
    const plans = json.data.plans as Array<{ tier: string; name: string; priceMonthly: number; priceYearly: number }>
    expect(plans.map((p) => p.tier).sort()).toEqual(['FREE', 'PREMIUM', 'PREMIUM_PLUS'])
    const byTier = Object.fromEntries(plans.map((p) => [p.tier, p]))
    expect(byTier.FREE.priceMonthly).toBe(0)
    expect(byTier.PREMIUM.priceMonthly).toBeGreaterThan(0)
    expect(byTier.PREMIUM_PLUS.priceMonthly).toBeGreaterThan(byTier.PREMIUM.priceMonthly)
  })
})

test.describe('subscription pages as a guest', () => {
  for (const path of [
    '/subscription',
    '/subscription/upgrade?tier=PREMIUM&billing=monthly',
    '/subscription/confirmation?updated=1&tier=PREMIUM&change=upgrade',
  ]) {
    test(`${path} sends a guest to /login`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    })
  }

  test('/subscription/upgrade never shows the order form or a price to a guest', async ({ page }) => {
    await page.goto('/subscription/upgrade?tier=PREMIUM_PLUS&billing=annual')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/Billed monthly|Billed annually/)).toHaveCount(0)
    await expect(page.locator('a[href^="https://checkout.stripe.com"]')).toHaveCount(0)
  })
})

// Signed-in flows, with the accounts from scripts/e2e-seed.mjs: the parent
// owns the seeded family (on Free), the child is an invited member of it and
// the no-family account belongs to no family. Checkout and promo-check are
// mocked with page.route, so Stripe is never reached and nothing is written.
test.describe('signed in', () => {
  test.describe('owner', () => {
    test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
    test.beforeEach(async ({ page }) => {
      await signInWithState(page, 'parent')
      await forceFreePlan(page)
    })
    // forceFreePlan proxies the real API, so a request can still be in flight when a test ends.
    test.afterEach(async ({ page }) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    })

    test('owner: /subscription shows the current plan and no account-holder notice', async ({ page }) => {
      await page.goto('/subscription')
      await expect(page.getByRole('heading', { name: /^(Subscription|My plan)$/ })).toBeVisible()
      await expect(page.getByText('Current plan').first()).toBeVisible()
      await expect(page.getByText('Plan changes are managed by the account holder.')).toHaveCount(0)
    })

    test('owner: Continue on the upgrade page goes to the Checkout URL from the API', async ({ page }) => {
      test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
      let sent: Record<string, unknown> | null = null
      await page.route('**/api/subscription/checkout', (route) => {
        sent = route.request().postDataJSON()
        return route.fulfill({ json: { success: true, url: '/subscription/confirmation?session_id=cs_test_mock' } })
      })
      await page.goto('/subscription/upgrade?tier=PREMIUM&billing=monthly')
      await expect(page.getByText('Billed monthly')).toBeVisible()
      await page.getByRole('button', { name: /^\s*(continue|subscribe|upgrade)/i }).first().click()
      await expect(page).toHaveURL(/\/subscription\/confirmation\?session_id=cs_test_mock/)
      expect(sent).toMatchObject({ familyId: PARENT_FAMILY_ID, tier: 'PREMIUM', billingCycle: 'monthly' })
      await expect(page.getByText('cs_test_mock')).toBeVisible()
      await expect(page.getByRole('link', { name: 'View Subscription' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Go to Dashboard' })).toBeVisible()
    })

    test('owner: an invalid promo code shows its error', async ({ page }) => {
      let checked: Record<string, unknown> | null = null
      await page.route('**/api/subscription/promo-check', (route) => {
        checked = route.request().postDataJSON()
        return route.fulfill({ json: { success: false, error: "That promo code isn't valid." } })
      })
      await page.goto('/subscription/upgrade?tier=PREMIUM&billing=monthly')
      await page.getByRole('textbox', { name: /promo/i }).fill('NOPE')
      await page.getByRole('button', { name: /apply/i }).click()
      await expect(page.getByText("That promo code isn't valid.")).toBeVisible()
      expect(checked).toMatchObject({ code: 'NOPE', tier: 'PREMIUM', billingCycle: 'monthly' })
    })
  })

  test.describe('child', () => {
    test.skip(!CHILD_STATE, 'E2E_CHILD_STATE (signed-in child storageState) not set')
    test.beforeEach(async ({ page }) => {
      await signInWithState(page, 'child')
      await forceFreePlan(page)
    })

    test('child: /subscription explains only the account holder can change the plan', async ({ page }) => {
      await page.goto('/subscription')
      await expect(page.getByText('Plan changes are managed by the account holder.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Manage billing' })).toHaveCount(0)
    })

    test('child: /subscription/upgrade shows the account-holder card, not the order form', async ({ page }) => {
      await page.goto('/subscription/upgrade?tier=PREMIUM&billing=monthly')
      await expect(page.getByText('Only the account holder can change the plan')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Back to Subscription' })).toBeVisible()
      await expect(page.getByText(/Billed monthly|Billed annually/)).toHaveCount(0)
    })
  })

  test.describe('no family', () => {
    test.skip(!NOFAMILY_STATE, 'E2E_NOFAMILY_STATE (signed-in account with no family) not set')
    test.beforeEach(async ({ page }) => {
      await signInWithState(page, 'nofamily')
    })

    test('no family: /subscription shows the empty state', async ({ page }) => {
      await page.goto('/subscription')
      await expect(page.getByText('No Family Yet')).toBeVisible()
      await expect(page.getByText('Create or join a family to manage your subscription.')).toBeVisible()
    })
  })
})