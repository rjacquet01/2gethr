import { test, expect, type Page, type Route } from '@playwright/test'
import { signInWithState } from '../helpers/auth'

// Location area: family map, background sharing (Android app), pings, SOS
// and emergency alerts. Like the other specs this runs against `next dev`
// with no sign-in and nothing written: the API checks are unauthenticated
// requests (or made-up device tokens) that every route refuses before it
// touches a row, and the confirm-device screen's own API call is intercepted
// with page.route, so no real token is ever confirmed or revoked.
// Signed-in flows at the bottom use the seeded parent / child / guest
// sessions (scripts/e2e-seed.mjs) and skip themselves when a state file is
// not given. They only read, or are refused before anything is written
// (reading /api/location/settings may create a default OFF settings row).

// Made-up values: never a real member, family, request or token.
const FAKE_FAMILY = 'fam_e2e_does_not_exist'
const FAKE_MEMBER = 'mem_e2e_does_not_exist'
const FAKE_TOKEN = 'e2e-not-a-real-device-token'
// The confirm route only accepts 48 lowercase hex characters.
const WELL_FORMED_CODE = 'ab'.repeat(24)

const CONFIRM_API = '**/api/location/device-token/confirm'

const PARENT_STATE = process.env.E2E_PARENT_STATE
const CHILD_STATE = process.env.E2E_CHILD_STATE
const GUEST_STATE = process.env.E2E_GUEST_STATE
const PARENT_FAMILY_ID = process.env.E2E_PARENT_FAMILY_ID
const GUEST_FAMILY_ID = process.env.E2E_GUEST_FAMILY_ID

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
      await expect(page.getByText(/Request location|Ping |Share now|Background sharing/)).toHaveCount(0)
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
  // Use the saved parent session when there is one (scripts/e2e-seed.mjs);
  // without it the dashboard sends the visitor to the sign-in screen and the test skips.
  await signInWithState(page, 'parent')
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
// Signed-in flows: parent vs child vs guest, and empty states, using the
// seeded family (a PARENT, a CHILD with a login "Seed Kid", a GUEST). States
// the seed cannot produce (a sharing child, a child without a login, a free
// plan) are served by mocking the GET /api/location response the page reads.
// ---------------------------------------------------------------------------

type FamilyMapBody = {
  success: boolean
  data?: unknown[]
  pingable?: unknown[]
  noAccountChildren?: unknown[]
  snapshots?: unknown[]
  error?: string
  code?: string
}

// Answers the page's GET /api/location (the family map) with `body`; every
// other location route and method goes to the real server.
async function mockFamilyMap(page: Page, body: FamilyMapBody, status = 200) {
  await page.route(
    (url) => url.pathname === '/api/location',
    (route) => (route.request().method() === 'GET' ? route.fulfill({ status, json: body }) : route.fallback()),
  )
}

async function myMemberId(page: Page, familyId: string): Promise<string | undefined> {
  const res = await page.request.get('/api/location/settings')
  expect(res.status(), await res.text()).toBe(200)
  const { data } = (await res.json()) as { data: Array<{ memberId: string; familyId: string }> }
  return data.find((s) => s.familyId === familyId)?.memberId
}

test.describe('location page, signed in as the parent', () => {
  test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
  test.beforeEach(async ({ page }) => { await signInWithState(page, 'parent') })

  test('parent: sees sharing children, "Request location" on each, and the grown-up access list', async ({ page }) => {
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')

    // Real API: the child with a login can be pinged, the guest never can.
    const real = await page.request.get(`/api/location?familyId=${PARENT_FAMILY_ID}`)
    const realBody = await real.json()
    if (real.status() === 403) {
      expect(realBody.code).toBe('SUBSCRIPTION_REQUIRED')
    } else {
      expect(real.status(), JSON.stringify(realBody)).toBe(200)
      const pingable = realBody.pingable as Array<{ name: string; role: string }>
      expect(pingable.some((p) => p.name.includes('Seed Kid') && p.role === 'CHILD')).toBe(true)
      expect(pingable.some((p) => p.role === 'GUEST')).toBe(false)
    }

    // The grown-up access list: the seeded family has no other adult (guests
    // and children take no part), so it is empty but answered.
    const access = await page.request.get(`/api/location/access?familyId=${PARENT_FAMILY_ID}`)
    expect(access.status()).toBe(200)
    const accessBody = await access.json()
    expect(accessBody.success).toBe(true)
    expect(accessBody.data.people).toEqual([])

    // UI with a sharing child (served by the mock).
    await mockFamilyMap(page, {
      success: true,
      data: [
        {
          memberId: 'mem_e2e_sharing_kid',
          userId: 'usr_e2e_sharing_kid',
          name: 'E2E Sharing Kid',
          role: 'CHILD',
          hasAccount: true,
          color: null,
          emoji: null,
          profilePhotoPath: null,
          locationMode: 'ACTIVE',
          location: {
            latitude: 51.5,
            longitude: -0.12,
            accuracy: 10,
            altitude: null,
            speed: null,
            heading: null,
            batteryLevel: 80,
            timestamp: new Date().toISOString(),
          },
        },
      ],
      pingable: [{ memberId: 'mem_e2e_sharing_kid', name: 'E2E Sharing Kid', role: 'CHILD', hasAccount: true }],
      noAccountChildren: [],
      snapshots: [],
    })
    await page.goto('/location', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('E2E Sharing Kid').first()).toBeVisible()
    // The ping button is labelled "Ping <name>" (its tooltip is "Request current location").
    await expect(page.getByRole('button', { name: 'Ping E2E Sharing Kid' })).toBeVisible()
  })

  test('parent: a child with no login is listed as "No account" with nothing to ping', async ({ page }) => {
    // The seeded family has no login-less child, so the map response is mocked.
    await mockFamilyMap(page, {
      success: true,
      data: [],
      pingable: [],
      noAccountChildren: [{ memberId: 'mem_e2e_no_login_kid', name: 'E2E No Login Kid', hasAccount: false, color: null, emoji: null }],
      snapshots: [],
    })
    await page.goto('/location', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('E2E No Login Kid').first()).toBeVisible()
    await expect(page.getByText('No account').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Ping / })).toHaveCount(0)
  })

  test('validation: PATCH settings with an update interval under 60s -> 400', async ({ page }) => {
    const res = await page.request.patch('/api/location/settings', { data: { memberId: FAKE_MEMBER, updateIntervalSec: 5 } })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBeTruthy()
  })

  test('validation: confirm-device with a malformed code -> 400 "This setup link is not valid."', async ({ page }) => {
    const res = await page.request.post('/api/location/device-token/confirm', { data: { code: 'nope' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'This setup link is not valid.' })
  })

  test('empty state: a family where nobody shares shows no member locations', async ({ page }) => {
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    // Nobody in the seeded family turns sharing on, so no child is on the map.
    const real = await page.request.get(`/api/location?familyId=${PARENT_FAMILY_ID}`)
    const realBody = await real.json()
    if (real.status() === 403) {
      expect(realBody.code).toBe('SUBSCRIPTION_REQUIRED')
    } else {
      expect(real.status()).toBe(200)
      const data = realBody.data as Array<{ role: string }>
      expect(data.filter((m) => m.role === 'CHILD' || m.role === 'GUEST')).toEqual([])
    }

    await mockFamilyMap(page, { success: true, data: [], pingable: [], noAccountChildren: [], snapshots: [] })
    await page.goto('/location', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: /^Ping / })).toHaveCount(0)
    await expect(page.getByText('No account')).toHaveCount(0)
  })

  test('free plan: location is gated behind the upgrade notice (prices hidden in the Android app)', async ({ page }) => {
    await mockFamilyMap(
      page,
      { success: false, error: 'Location sharing requires a Premium subscription', code: 'SUBSCRIPTION_REQUIRED' },
      403,
    )
    await page.goto('/location?source=android-app', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: /^Ping / })).toHaveCount(0)
    await expect(page.locator('a[href="/pricing"], a[href^="/subscription/upgrade"]')).toHaveCount(0)
  })
})

test.describe('location page, signed in as the child', () => {
  test.skip(!CHILD_STATE, 'E2E_CHILD_STATE (signed-in child storageState) not set')
  test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID (the seeded family) not set')
  test.beforeEach(async ({ page }) => { await signInWithState(page, 'child') })

  test('child: sees only the grown-ups who share, no access requests to other grown-ups', async ({ page }) => {
    await page.goto('/location', { waitUntil: 'networkidle' })

    const access = await page.request.get(`/api/location/access?familyId=${PARENT_FAMILY_ID}`)
    expect(access.status()).toBe(200)
    expect((await access.json()).data.people).toEqual([])

    const ask = await page.request.post('/api/location/access', {
      data: { familyId: PARENT_FAMILY_ID, memberId: FAKE_MEMBER, action: 'request' },
    })
    expect(ask.status()).toBe(403)
    expect((await ask.json()).error).toBe('Only adults in this family can do this')

    const map = await page.request.get(`/api/location?familyId=${PARENT_FAMILY_ID}`)
    const mapBody = await map.json()
    if (map.status() === 403) {
      expect(mapBody.code).toBe('SUBSCRIPTION_REQUIRED')
    } else {
      expect(map.status()).toBe(200)
      for (const m of mapBody.data as Array<{ role: string }>) {
        expect(['PARENT', 'GUARDIAN', 'ADULT']).toContain(m.role)
      }
      expect(mapBody.noAccountChildren).toEqual([])
    }
  })

  test('child: cannot send an emergency alert (403)', async ({ page }) => {
    const memberId = await myMemberId(page, PARENT_FAMILY_ID!)
    expect(memberId, "the child's own member id").toBeTruthy()

    const res = await page.request.post('/api/location/emergency-alert', {
      data: { familyId: PARENT_FAMILY_ID, memberId },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Only a parent or guardian can send an emergency alert')

    const eligibility = await page.request.get(`/api/location/emergency-alert?familyId=${PARENT_FAMILY_ID}`)
    expect(eligibility.status()).toBe(200)
    expect((await eligibility.json()).data).toMatchObject({ eligible: false, reason: 'NOT_PARENT', children: [] })
  })
})

test.describe('location page, signed in as the guest', () => {
  test.skip(!GUEST_STATE, 'E2E_GUEST_STATE (signed-in guest storageState) not set')
  test.beforeEach(async ({ page }) => { await signInWithState(page, 'guest') })

  test('guest: /location shows the guest notice, location APIs answer 403', async ({ page }) => {
    await page.goto('/location', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: /^Ping / })).toHaveCount(0)
    await expect(page.getByText(/Share now|Background sharing/)).toHaveCount(0)

    const res = await page.request.get('/api/location/settings')
    expect(res.status()).toBe(403)

    const awaiting = await page.request.get('/api/location/request?awaiting=1')
    expect(awaiting.status()).toBe(403)

    if (GUEST_FAMILY_ID) {
      const map = await page.request.get(`/api/location?familyId=${GUEST_FAMILY_ID}`)
      expect(map.status()).toBe(403)
      expect(JSON.stringify(await map.json().catch(() => ({})))).not.toMatch(/latitude|longitude/i)

      const alert = await page.request.get(`/api/location/emergency-alert?familyId=${GUEST_FAMILY_ID}`)
      expect(alert.status()).toBe(403)

      // Refused before any alert is dispatched.
      const sos = await page.request.post('/api/location/sos', {
        data: { familyId: GUEST_FAMILY_ID, message: 'e2e test - not a real SOS' },
      })
      expect(sos.status()).toBe(403)
    }
  })
})