import { test, expect, type Page, type Route } from '@playwright/test'

// Location area: family map, background sharing (Android app), pings, SOS
// and emergency alerts. Like the other specs this runs against `next dev`
// with no sign-in and nothing written: the API checks are unauthenticated
// requests (or made-up device tokens) that every route refuses before it
// touches a row, and the confirm-device screen's own API call is intercepted
// with page.route, so no real token is ever confirmed or revoked.
// Flows that need a signed-in parent, child or guest are listed at the
// bottom and skipped: this suite has no accounts or families to sign in with.

// Made-up values: never a real member, family, request or token.
const FAKE_FAMILY = 'fam_e2e_does_not_exist'
const FAKE_MEMBER = 'mem_e2e_does_not_exist'
const FAKE_TOKEN = 'e2e-not-a-real-device-token'
// The confirm route only accepts 48 lowercase hex characters.
const WELL_FORMED_CODE = 'ab'.repeat(24)

const CONFIRM_API = '**/api/location/device-token/confirm'

// ---------------------------------------------------------------------------
// Signed-out visitors (a "guest" in the loosest sense): every location API
// refuses them before validating input or reading the database.
// ---------------------------------------------------------------------------

type Call = {
  name: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  data?: unknown
}

const SIGNED_OUT_CALLS: Call[] = [
  { name: 'family map', method: 'GET', path: `/api/location?familyId=${FAKE_FAMILY}` },
  { name: 'post a location fix', method: 'POST', path: '/api/location', data: { latitude: 51.5, longitude: -0.12 } },
  { name: 'read my settings', method: 'GET', path: '/api/location/settings' },
  { name: "read a member's settings", method: 'GET', path: `/api/location/settings?memberId=${FAKE_MEMBER}` },
  { name: 'turn sharing on', method: 'PATCH', path: '/api/location/settings', data: { memberId: FAKE_MEMBER, mode: 'ACTIVE', shareWithFamily: true } },
  { name: 'grown-up access list', method: 'GET', path: `/api/location/access?familyId=${FAKE_FAMILY}` },
  { name: 'request grown-up access', method: 'POST', path: '/api/location/access', data: { familyId: FAKE_FAMILY, memberId: FAKE_MEMBER, action: 'request' } },
  { name: 'route history', method: 'GET', path: `/api/location/history?memberId=${FAKE_MEMBER}&familyId=${FAKE_FAMILY}` },
  { name: 'open pings for my device', method: 'GET', path: '/api/location/request' },
  { name: 'pings awaiting my approval', method: 'GET', path: '/api/location/request?awaiting=1' },
  { name: 'ping a member', method: 'POST', path: '/api/location/request', data: { memberId: FAKE_MEMBER, familyId: FAKE_FAMILY } },
  { name: 'approve a ping', method: 'POST', path: '/api/location/request/locreq_e2e_fake', data: { action: 'approve' } },
  { name: 'background sharing status', method: 'GET', path: `/api/location/device-token?memberId=${FAKE_MEMBER}&familyId=${FAKE_FAMILY}` },
  { name: 'issue a device token', method: 'POST', path: '/api/location/device-token', data: { memberId: FAKE_MEMBER, familyId: FAKE_FAMILY } },
  { name: 'stop background sharing (web)', method: 'DELETE', path: `/api/location/device-token?memberId=${FAKE_MEMBER}&familyId=${FAKE_FAMILY}` },
  { name: 'share now from the app', method: 'POST', path: '/api/location/device-token/refresh', data: { memberId: FAKE_MEMBER, familyId: FAKE_FAMILY } },
  { name: 'confirm a device (well-formed code)', method: 'POST', path: '/api/location/device-token/confirm', data: { code: WELL_FORMED_CODE } },
  { name: 'confirm a device (malformed code)', method: 'POST', path: '/api/location/device-token/confirm', data: { code: 'nope' } },
  { name: 'emergency alert eligibility', method: 'GET', path: `/api/location/emergency-alert?familyId=${FAKE_FAMILY}` },
  { name: 'send an emergency alert', method: 'POST', path: '/api/location/emergency-alert', data: { familyId: FAKE_FAMILY, memberId: FAKE_MEMBER } },
  { name: "answer an emergency alert (I'm OK)", method: 'POST', path: '/api/location/emergency-alert/ack', data: { alertId: 'emg_e2e_fake' } },
  { name: 'send SOS', method: 'POST', path: '/api/location/sos', data: { familyId: FAKE_FAMILY } },
]

test.describe('location APIs refuse a signed-out visitor', () => {
  for (const call of SIGNED_OUT_CALLS) {
    test(`${call.method} ${call.name} -> 401`, async ({ request }) => {
      const res = await request.fetch(call.path, {
        method: call.method,
        data: call.data,
        headers: { cookie: '' },
        maxRedirects: 0,
      })
      expect(res.status(), `${call.method} ${call.path}`).toBe(401)
      const body = await res.json().catch(() => ({}))
      expect(body.success, 'never reports success').not.toBe(true)
      expect(JSON.stringify(body), 'no location data leaks').not.toMatch(/latitude|longitude/i)
    })
  }

  test('auth is checked before validation: a malformed body still gets 401, not 400', async ({ request }) => {
    const res = await request.patch('/api/location/settings', {
      headers: { cookie: '' },
      data: { memberId: '', updateIntervalSec: 5 },
    })
    expect(res.status()).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// The Android background service authenticates with a device token instead of
// a session. Missing or made-up tokens are refused.
// ---------------------------------------------------------------------------

test.describe('device-token endpoints (Android background service)', () => {
  test('claim with no token -> 401 "Missing device token"', async ({ request }) => {
    const res = await request.post('/api/location/device-token/claim', { headers: { cookie: '' } })
    expect(res.status()).toBe(401)
    expect(await res.json()).toMatchObject({ success: false, error: 'Missing device token' })
  })

  test('claim with an unknown token -> 401, no code or names returned', async ({ request }) => {
    const res = await request.post('/api/location/device-token/claim', {
      headers: { cookie: '', 'x-device-token': FAKE_TOKEN },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ success: false, error: 'Invalid or expired device token' })
    expect(body).not.toHaveProperty('code')
    expect(body).not.toHaveProperty('familyName')
  })

  test('poll with no token -> 401 "Missing device token"', async ({ request }) => {
    const res = await request.get('/api/location/poll', { headers: { cookie: '' } })
    expect(res.status()).toBe(401)
    expect(await res.json()).toMatchObject({ success: false, error: 'Missing device token' })
  })

  test('poll with an unknown token -> 401, no sharing state returned', async ({ request }) => {
    const res = await request.get('/api/location/poll', { headers: { cookie: '', 'x-device-token': FAKE_TOKEN } })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ success: false, error: 'Invalid or revoked device token' })
    expect(body).not.toHaveProperty('data')
  })

  test('posting a fix with an unknown token -> 401', async ({ request }) => {
    const res = await request.post('/api/location', {
      headers: { cookie: '', 'x-device-token': FAKE_TOKEN },
      data: { latitude: 51.5, longitude: -0.12, batteryLevel: 80 },
    })
    expect(res.status()).toBe(401)
    expect(await res.json()).toMatchObject({ success: false, error: 'Invalid or revoked device token' })
  })

  test('SOS with an unknown token -> 401, nobody is alerted', async ({ request }) => {
    const res = await request.post('/api/location/sos', {
      headers: { cookie: '', 'x-device-token': FAKE_TOKEN },
      data: { message: 'e2e test - not a real SOS' },
    })
    expect(res.status()).toBe(401)
    expect(await res.json()).toMatchObject({ success: false, error: 'Not authenticated' })
  })
})

// ---------------------------------------------------------------------------
// Pages, signed out.
// ---------------------------------------------------------------------------

test.describe('location pages, signed out', () => {
  for (const path of ['/location', '/places']) {
    test(`${path} sends a signed-out visitor to sign in and shows no family location`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'networkidle' })
      expect(res?.status(), `${path} HTTP status`).toBeLessThan(500)
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
      await expect(page.getByText(/Request location|Share now|Background sharing/)).toHaveCount(0)
    })
  }
})

// ---------------------------------------------------------------------------
// /location/confirm-device: the Android app opens it with a one-time code in
// the URL fragment. The confirm API is mocked, so every state is deterministic
// and no real token is touched.
// ---------------------------------------------------------------------------

/**
 * Open the confirm page with `hash` and wait for it (or the sign-in screen).
 * Skips the test if the dashboard sends signed-out visitors to /login before
 * the page mounts. Exercising the screen then needs a signed-in session,
 * which this suite doesn't have.
 */
async function openConfirmDevice(page: Page, hash: string) {
  await page.goto(`/location/confirm-device${hash}`)
  const card = page.getByText('Background sharing', { exact: true })
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(card.or(signIn).first()).toBeVisible()
  test.skip(
    await signIn.isVisible(),
    'Dashboard pages need a signed-in session before they mount; no test account is available.'
  )
}

function mockConfirm(page: Page, reply: (route: Route) => Promise<void>) {
  const seen: Array<{ code?: unknown }> = []
  return page
    .route(CONFIRM_API, async (route) => {
      seen.push(route.request().postDataJSON() ?? {})
      await reply(route)
    })
    .then(() => seen)
}

test.describe('confirm-device page (Android background sharing)', () => {
  test('happy path: sends the code once, drops it from the address bar, offers Start sharing', async ({ page }) => {
    const sent = await mockConfirm(page, (route) =>
      route.fulfill({ status: 200, json: { success: true, name: 'Sam', familyName: 'The Testers' } })
    )
    await openConfirmDevice(page, `#c=${WELL_FORMED_CODE}`)

    const summary = page.getByText(/This phone will share/)
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('Sam')
    await expect(summary).toContainText('The Testers')
    await expect(summary).toContainText('even when Togethr is closed')
    await expect(page.getByRole('button', { name: 'Start sharing' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Location' })).toHaveCount(0)

    expect(sent).toHaveLength(1)
    expect(sent[0].code).toBe(WELL_FORMED_CODE)
    await expect(page).toHaveURL(/\/location\/confirm-device$/)
    expect(page.url()).not.toContain(WELL_FORMED_CODE)
  })

  test('no code in the link: shows the server error and a way back', async ({ page }) => {
    const sent = await mockConfirm(page, (route) =>
      route.fulfill({ status: 400, json: { success: false, error: 'This setup link is not valid.' } })
    )
    await openConfirmDevice(page, '')
    await expect(page.getByText('This setup link is not valid.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Location' })).toHaveAttribute('href', '/location')
    await expect(page.getByRole('button', { name: 'Start sharing' })).toHaveCount(0)
    expect(sent[0]?.code).toBe('')
  })

  test('expired link: explains how to start again', async ({ page }) => {
    await mockConfirm(page, (route) =>
      route.fulfill({
        status: 410,
        json: {
          success: false,
          code: 'EXPIRED',
          error: 'This setup link has expired. Turn on background sharing again from the Location page.',
        },
      })
    )
    await openConfirmDevice(page, `#c=${WELL_FORMED_CODE}`)
    await expect(page.getByText(/This setup link has expired/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start sharing' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Back to Location' })).toBeVisible()
  })

  test('token from another account: refused, sharing is not offered', async ({ page }) => {
    await mockConfirm(page, (route) =>
      route.fulfill({
        status: 403,
        json: {
          success: false,
          code: 'OTHER_ACCOUNT',
          error: 'This setup link was made from a different Togethr account, so background sharing was not turned on. Only turn it on from your own account in the Togethr app.',
        },
      })
    )
    await openConfirmDevice(page, `#c=${WELL_FORMED_CODE}`)
    await expect(page.getByText(/made from a different Togethr account/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start sharing' })).toHaveCount(0)
  })

  test('server error with no message: falls back to the generic message', async ({ page }) => {
    await mockConfirm(page, (route) => route.fulfill({ status: 500, json: {} }))
    await openConfirmDevice(page, `#c=${WELL_FORMED_CODE}`)
    await expect(page.getByText('Background sharing could not be turned on.', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Location' })).toBeVisible()
  })

  test('offline: asks the user to check their connection', async ({ page }) => {
    await mockConfirm(page, (route) => route.abort('internetdisconnected'))
    await openConfirmDevice(page, `#c=${WELL_FORMED_CODE}`)
    await expect(page.getByText(/Check your connection and try again\./)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Location' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Signed-in flows: parent vs child vs guest, and empty states. These need
// seeded accounts (a Premium family with a parent, a second grown-up, a child
// with a login, a child without one, and a guest) and a way to sign in
// without email codes. Neither exists for this suite, which is public pages
// only with no writes, so they are skipped. Each test notes what it should
// check once a seeded test family exists.
// ---------------------------------------------------------------------------

test.describe('location page, signed in (needs seeded accounts)', () => {
  test.skip(true, 'Needs signed-in parent/child/guest test accounts in a seeded family; this suite runs signed out with no DB writes.')

  test('parent: sees sharing children, "Request location" on each, and the grown-up access list', async ({ page }) => {
    await page.goto('/location', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: /Request location/ }).first()).toBeVisible()
  })

  test('parent: a child with no login is listed as "No account" with nothing to ping', async ({ page }) => {
    await page.goto('/location', { waitUntil: 'networkidle' })
    await expect(page.getByText('No account').first()).toBeVisible()
  })

  test('child: sees only the grown-ups who share, no access requests to other grown-ups', async ({ page }) => {
    await page.goto('/location', { waitUntil: 'networkidle' })
    const res = await page.request.get(`/api/location/access?familyId=${FAKE_FAMILY}`)
    expect((await res.json()).data.people).toEqual([])
  })

  test('child: cannot send an emergency alert (403)', async ({ page }) => {
    const res = await page.request.post('/api/location/emergency-alert', { data: { memberId: FAKE_MEMBER } })
    expect(res.status()).toBe(403)
  })

  test('guest: /location shows the guest notice, location APIs answer 403', async ({ page }) => {
    await page.goto('/location', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: /Request location/ })).toHaveCount(0)
    const res = await page.request.get('/api/location/settings')
    expect(res.status()).toBe(403)
  })

  test('validation: PATCH settings with an update interval under 60s -> 400', async ({ page }) => {
    const res = await page.request.patch('/api/location/settings', { data: { memberId: FAKE_MEMBER, updateIntervalSec: 5 } })
    expect(res.status()).toBe(400)
  })

  test('validation: confirm-device with a malformed code -> 400 "This setup link is not valid."', async ({ page }) => {
    const res = await page.request.post('/api/location/device-token/confirm', { data: { code: 'nope' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'This setup link is not valid.' })
  })

  test('empty state: a family where nobody shares shows no member locations', async ({ page }) => {
    await page.goto('/location', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: /Request location/ })).toHaveCount(0)
  })

  test('free plan: location is gated behind the upgrade notice (prices hidden in the Android app)', async ({ page }) => {
    await page.goto('/location?source=android-app', { waitUntil: 'networkidle' })
    await expect(page.locator('a[href="/pricing"], a[href^="/subscription/upgrade"]')).toHaveCount(0)
  })
})
