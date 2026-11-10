import { test, expect, type APIRequestContext } from '@playwright/test'

// Subscription area: the Subscription page, the upgrade (checkout) page, the
// confirmation page and the /api/subscription(s) routes. The dev server reads
// .env.local (the Neon dev branch), and these smoke tests never sign in, so
// every request here is a guest's. Every route checks the Android app and the
// signed-in user before it reads a body, calls Stripe or writes a row, so
// nothing is written and Stripe is never reached. Flows that need a signed-in
// parent or child (with a family) are listed at the end and skipped.

const ANDROID = { cookie: 'togethr_android=1', referer: 'android-app://com.togethrapp.mobile/' }
const FAKE_FAMILY = '00000000-0000-0000-0000-000000000000'

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

// Signed-in flows. These need a parent account that owns a family, a child
// (invited member) of that family and an account with no family. Smoke tests
// run without credentials and must not write to the database (starting or
// cancelling a trial writes rows), so they are skipped. Stripe would be
// mocked with page.route if they were enabled.
test.describe('signed in', () => {
  // Needs: a signed-in parent who owns a family on Free.
  test.skip('owner: /subscription shows the current plan and no account-holder notice', async ({ page }) => {
    await page.goto('/subscription')
    await expect(page.getByRole('heading', { name: /Subscription|My plan/ })).toBeVisible()
    await expect(page.getByText('Current plan')).toBeVisible()
    await expect(page.getByText('Plan changes are managed by the account holder.')).toHaveCount(0)
  })

  // Needs: a signed-in parent owner; checkout is mocked so Stripe is not reached.
  test.skip('owner: Continue on the upgrade page goes to the Checkout URL from the API', async ({ page }) => {
    await page.route('**/api/subscription/checkout', (route) =>
      route.fulfill({ json: { success: true, url: '/subscription/confirmation?session_id=cs_test_mock' } }),
    )
    await page.goto('/subscription/upgrade?tier=PREMIUM&billing=monthly')
    await page.getByRole('button', { name: /continue|subscribe|upgrade/i }).click()
    await expect(page).toHaveURL(/\/subscription\/confirmation\?session_id=cs_test_mock/)
    await expect(page.getByText('cs_test_mock')).toBeVisible()
    await expect(page.getByRole('link', { name: 'View Subscription' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go to Dashboard' })).toBeVisible()
  })

  // Needs: a signed-in parent owner; promo-check is mocked.
  test.skip('owner: an invalid promo code shows its error', async ({ page }) => {
    await page.route('**/api/subscription/promo-check', (route) =>
      route.fulfill({ json: { success: false, error: "That promo code isn't valid." } }),
    )
    await page.goto('/subscription/upgrade?tier=PREMIUM&billing=monthly')
    await page.getByRole('textbox', { name: /promo/i }).fill('NOPE')
    await page.getByRole('button', { name: /apply/i }).click()
    await expect(page.getByText("That promo code isn't valid.")).toBeVisible()
  })

  // Needs: a signed-in child (invited member) of a family owned by someone else.
  test.skip('child: /subscription explains only the account holder can change the plan', async ({ page }) => {
    await page.goto('/subscription')
    await expect(page.getByText('Plan changes are managed by the account holder.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Manage billing' })).toHaveCount(0)
  })

  // Needs: a signed-in child (invited member) of a family owned by someone else.
  test.skip('child: /subscription/upgrade shows the account-holder card, not the order form', async ({ page }) => {
    await page.goto('/subscription/upgrade?tier=PREMIUM&billing=monthly')
    await expect(page.getByText('Only the account holder can change the plan')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Subscription' })).toBeVisible()
  })

  // Needs: a signed-in account that belongs to no family.
  test.skip('no family: /subscription shows the empty state', async ({ page }) => {
    await page.goto('/subscription')
    await expect(page.getByText('No Family Yet')).toBeVisible()
    await expect(page.getByText('Create or join a family to manage your subscription.')).toBeVisible()
  })
})
