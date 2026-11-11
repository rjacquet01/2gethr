import { signInWithState } from '../helpers/auth'
import { test, expect, type Page } from '@playwright/test'

// Settings (/settings, /settings/calendar-sync) and the profile APIs behind
// them (/api/auth/profile, /api/auth/profile/photo).
//
// Guest tests need nothing: they only send unauthenticated requests, which the
// server refuses before touching the database.
//
// Signed-in tests are opt-in. They need dedicated accounts on the Neon dev
// branch, passed in the environment:
//   E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD  (a parent in a family, no 2FA)
//   E2E_CHILD_EMAIL  / E2E_CHILD_PASSWORD   (a child login, no 2FA)
// Without them, those tests are skipped. Once signed in, every non-GET /api/
// request from the page is aborted unless the test mocks it, so nothing is
// written. The direct API calls below are all ones the server rejects before
// any write (auth, validation, child-name rule). Nothing reaches Google, Apple,
// Stripe, SMS or email.

const PARENT = { email: process.env.E2E_PARENT_EMAIL, password: process.env.E2E_PARENT_PASSWORD }
const CHILD = { email: process.env.E2E_CHILD_EMAIL, password: process.env.E2E_CHILD_PASSWORD }

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

async function signIn(page: Page, creds: { email?: string; password?: string }) {
  // Reuse the saved session when there is one (the login API rate-limits repeat sign-ins).
  if (await signInWithState(page, creds === CHILD ? 'child' : 'parent')) return
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(creds.email!)
  await page.locator('input[type="password"]').fill(creds.password!)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

// Abort every write the page attempts; tests register narrower mocks after
// this, and later routes take precedence.
async function blockWrites(page: Page) {
  await page.route('**/api/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort()
  )
}

// The app authenticates its own API calls; reuse the Authorization header it
// sends (cookies are shared with page.request automatically).
async function authHeaders(page: Page): Promise<Record<string, string>> {
  let authorization: string | undefined
  const listener = (req: { url(): string; headers(): Record<string, string> }) => {
    if (req.url().includes('/api/') && req.headers()['authorization']) authorization = req.headers()['authorization']
  }
  page.on('request', listener)
  await page.goto('/settings', { waitUntil: 'networkidle' })
  page.off('request', listener)
  return authorization ? { authorization } : {}
}

test.describe('guest (signed out)', () => {
  test('GET /api/auth/profile is refused', async ({ request }) => {
    const res = await request.get('/api/auth/profile')
    expect(res.status()).toBe(401)
    expect((await res.json()).success).toBe(false)
  })

  test('PATCH /api/auth/profile is refused before validation', async ({ request }) => {
    const res = await request.patch('/api/auth/profile', { data: { firstName: 'x'.repeat(500) } })
    expect(res.status()).toBe(401)
    expect((await res.json()).success).toBe(false)
  })

  test('PATCH /api/auth/profile with a bogus bearer token is refused', async ({ request }) => {
    const res = await request.patch('/api/auth/profile', {
      headers: { authorization: 'Bearer not-a-real-token' },
      data: { firstName: 'Nobody' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/auth/profile/photo is refused', async ({ request }) => {
    const res = await request.post('/api/auth/profile/photo', {
      multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: TINY_PNG } },
    })
    expect(res.status()).toBe(401)
    expect((await res.json()).success).toBe(false)
  })

  test('DELETE /api/auth/profile/photo is refused', async ({ request }) => {
    const res = await request.delete('/api/auth/profile/photo')
    expect(res.status()).toBe(401)
    expect((await res.json()).success).toBe(false)
  })

  test('/settings/calendar-sync does not render the sync controls', async ({ page }) => {
    await page.goto('/settings/calendar-sync', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Calendar & task sync' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Sync all' })).toHaveCount(0)
  })

  test('/settings does not render the profile photo picker', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
  })
})

test.describe('parent', () => {
  test.skip(!PARENT.email || !PARENT.password, 'needs E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD (dev-branch test account)')

  test.beforeEach(async ({ page }) => {
    await signIn(page, PARENT)
    await blockWrites(page)
  })

  test('profile photo: wrong file type is rejected in the browser', async ({ page }) => {
    let uploaded = false
    await page.route('**/api/auth/profile/photo', (route) => {
      uploaded = true
      return route.abort()
    })
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(page.getByText('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.')).toBeVisible()
    expect(uploaded).toBe(false)
  })

  test('profile photo: a file over 5MB is rejected in the browser', async ({ page }) => {
    let uploaded = false
    await page.route('**/api/auth/profile/photo', (route) => {
      uploaded = true
      return route.abort()
    })
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    })
    await expect(page.getByText('File too large. Maximum size is 5MB.')).toBeVisible()
    expect(uploaded).toBe(false)
  })

  test('profile photo: a valid image uploads (mocked) and confirms', async ({ page }) => {
    await page.route('**/api/auth/profile/photo', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, json: { success: true, data: { pathname: 'profile-photos/e2e/a.png' } } })
        : route.continue()
    )
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: TINY_PNG })
    await expect(page.getByText('Profile photo updated!')).toBeVisible()
  })

  test('profile photo: a server error is shown to the user (mocked)', async ({ page }) => {
    await page.route('**/api/auth/profile/photo', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { success: false, error: 'Failed to upload profile photo' } })
        : route.continue()
    )
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: TINY_PNG })
    await expect(page.getByText('Failed to upload profile photo')).toBeVisible()
  })

  test('PATCH /api/auth/profile validation errors (nothing written)', async ({ page }) => {
    const headers = await authHeaders(page)

    const longName = await page.request.patch('/api/auth/profile', { headers, data: { firstName: 'x'.repeat(101) } })
    expect(longName.status()).toBe(400)
    expect((await longName.json()).success).toBe(false)

    const longPhone = await page.request.patch('/api/auth/profile', { headers, data: { phone: '1'.repeat(21) } })
    expect(longPhone.status()).toBe(400)

    const badTz = await page.request.patch('/api/auth/profile', { headers, data: { timezone: 'Mars/Olympus_Mons' } })
    expect(badTz.status()).toBe(400)
    expect((await badTz.json()).error).toBe('Invalid timezone')

    const empty = await page.request.patch('/api/auth/profile', { headers, data: {} })
    expect(empty.status()).toBe(400)
    expect((await empty.json()).error).toBe('No fields to update')
  })

  test('GET /api/auth/profile returns the signed-in user', async ({ page }) => {
    const headers = await authHeaders(page)
    const res = await page.request.get('/api/auth/profile', { headers })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.email.toLowerCase()).toBe(PARENT.email!.toLowerCase())
  })

  test.describe('calendar sync', () => {
    test.beforeEach(async ({ page }) => {
      // No subscription link yet: the page offers to create one.
      await page.route('**/api/calendar-sync/ical/generate', (route) =>
        route.request().method() === 'GET' ? route.fulfill({ status: 200, json: { success: false } }) : route.abort()
      )
    })

    test('page renders with a back link and Sync all', async ({ page }) => {
      await page.goto('/settings/calendar-sync', { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Calendar & task sync' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Back to settings' })).toHaveAttribute('href', '/settings')
      await expect(page.getByRole('button', { name: 'Sync all' })).toBeVisible()
      await expect(page.getByText(/subscription link on/)).toHaveCount(0)
    })

    test('?success=google shows the connected message', async ({ page }) => {
      await page.goto('/settings/calendar-sync?success=google', { waitUntil: 'networkidle' })
      await expect(page.getByText('Google Calendar connected!')).toBeVisible()
    })

    const ERRORS: Array<[string, string]> = [
      ['denied', 'Calendar access was denied'],
      ['invalid_state', 'Invalid authentication state'],
      ['no_family', 'You need to be part of a family before connecting a calendar'],
      ['something_unknown', 'Connection failed'],
    ]
    for (const [code, message] of ERRORS) {
      test(`?error=${code} shows "${message}"`, async ({ page }) => {
        await page.goto(`/settings/calendar-sync?error=${code}`, { waitUntil: 'networkidle' })
        await expect(page.getByText(message, { exact: true })).toBeVisible()
      })
    }

    test('empty state: Sync all with nothing connected explains what to do', async ({ page }) => {
      // Needs an account with no Google/Apple connection; the connections
      // endpoint's shape is internal to useCalendarSync, so it is not mocked.
      test.skip(process.env.E2E_PARENT_NO_CALENDAR !== '1', 'set E2E_PARENT_NO_CALENDAR=1 when the parent account has no calendar connections')
      await page.goto('/settings/calendar-sync', { waitUntil: 'networkidle' })
      await expect(page.getByText('No accounts connected')).toBeVisible()
      await page.getByRole('button', { name: 'Sync all' }).click()
      await expect(page.getByText('Nothing to sync yet - connect and turn on a calendar first')).toBeVisible()
    })
  })
})

test.describe('child', () => {
  test.skip(!CHILD.email || !CHILD.password, 'needs E2E_CHILD_EMAIL / E2E_CHILD_PASSWORD (dev-branch child login)')

  test.beforeEach(async ({ page }) => {
    await signIn(page, CHILD)
    await blockWrites(page)
  })

  test('a child cannot change their own name (server refuses, nothing written)', async ({ page }) => {
    const headers = await authHeaders(page)
    const res = await page.request.patch('/api/auth/profile', {
      headers,
      data: { firstName: `E2E-should-not-save-${Date.now()}` },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Your name is set by your parent. Ask them to change it on your profile.')
  })

  test('a child gets the same photo validation as a parent', async ({ page }) => {
    let uploaded = false
    await page.route('**/api/auth/profile/photo', (route) => {
      uploaded = true
      return route.abort()
    })
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') })
    await expect(page.getByText('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.')).toBeVisible()
    expect(uploaded).toBe(false)
  })
})
