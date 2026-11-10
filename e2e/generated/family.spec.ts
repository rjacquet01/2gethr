import { test, expect, type Page, type Request, type Route } from '@playwright/test'

// Family area: /family, /family/settings, /family/child/[childId] and the
// /api/families/* routes. The signed-out checks need nothing and write
// nothing. The signed-in checks only run with test accounts on the Neon dev
// branch (set the E2E_* env vars below), and they never write anything:
// - destructive dialogs are opened, checked and cancelled
// - every save goes to a page.route() mock, never to the real API
// The parent account is assumed to own its family. Tests that need ownership
// skip themselves when the owner-only controls are missing.

const ACCOUNTS = {
  parent: { email: process.env.E2E_PARENT_EMAIL, password: process.env.E2E_PARENT_PASSWORD },
  child: { email: process.env.E2E_CHILD_EMAIL, password: process.env.E2E_CHILD_PASSWORD },
  guest: { email: process.env.E2E_GUEST_EMAIL, password: process.env.E2E_GUEST_PASSWORD },
} as const
type Role = keyof typeof ACCOUNTS

const hasAccount = (role: Role) => !!ACCOUNTS[role].email && !!ACCOUNTS[role].password

async function signIn(page: Page, role: Role) {
  const { email, password } = ACCOUNTS[role]
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(email!)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// A family / child id that never exists on the dev branch.
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

// ---------------------------------------------------------------------------
// Signed out: every family API refuses with 401 before reading the body, so
// nothing is created or changed.
// ---------------------------------------------------------------------------

const UNAUTHENTICATED_CALLS: Array<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; data?: unknown }> = [
  { method: 'GET', path: '/api/families' },
  { method: 'POST', path: '/api/families', data: { name: 'E2E should never exist' } },
  { method: 'GET', path: '/api/families/join' },
  { method: 'POST', path: '/api/families/join', data: { inviteCode: 'ABCDEFGH' } },
  { method: 'GET', path: '/api/families/pending-consents' },
  { method: 'GET', path: `/api/families/${MISSING_ID}/children` },
  { method: 'POST', path: `/api/families/${MISSING_ID}/children`, data: { displayName: 'Nobody', consent: true } },
  { method: 'GET', path: `/api/families/${MISSING_ID}/member-activities` },
  { method: 'GET', path: `/api/families/${MISSING_ID}/invite` },
  { method: 'POST', path: `/api/families/${MISSING_ID}/invite`, data: { role: 'GUEST' } },
  { method: 'GET', path: `/api/families/${MISSING_ID}/join-requests` },
  { method: 'GET', path: `/api/families/${MISSING_ID}/board` },
  { method: 'GET', path: `/api/families/${MISSING_ID}/board/unread` },
  { method: 'GET', path: `/api/families/${MISSING_ID}/board/taken-down` },
  { method: 'POST', path: `/api/families/${MISSING_ID}/children/${MISSING_ID}/consent`, data: { consent: true } },
  { method: 'POST', path: `/api/families/${MISSING_ID}/children/${MISSING_ID}/account-invite`, data: { consent: true } },
]

test.describe('signed out', () => {
  for (const call of UNAUTHENTICATED_CALLS) {
    test(`${call.method} ${call.path.replace(MISSING_ID, ':id').replace(MISSING_ID, ':id')} needs sign-in (401)`, async ({ request }) => {
      const res = await request.fetch(call.path, {
        method: call.method,
        data: call.data,
        headers: { cookie: '' },
      })
      expect(res.status()).toBe(401)
      const body = await res.json()
      expect(body.success ?? false).toBe(false)
      expect(JSON.stringify(body)).not.toMatch(/inviteCode|familyId|members/)
    })
  }

  test('POST /api/families/join with no invite code is still refused as signed out, not as a validation error', async ({ request }) => {
    const res = await request.post('/api/families/join', { data: {} })
    expect(res.status()).toBe(401)
  })

  for (const path of ['/family', '/family/settings', `/family/child/${MISSING_ID}`]) {
    test(`${path} sends a signed-out visitor to /login`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: 'Family Settings' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Delete Family' })).toHaveCount(0)
    })
  }
})

// ---------------------------------------------------------------------------
// Child profile page with a mocked /api/children/:id (the real API is never
// called, so saves write nothing).
// ---------------------------------------------------------------------------

const MOCK_CHILD_ID = 'e2e-mock-child'

function mockProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: MOCK_CHILD_ID,
    displayName: 'Mock Kid',
    avatarUrl: null,
    grade: null,
    school: null,
    age: null,
    birthDate: null,
    dateOfBirth: null,
    turns18On: null,
    daysUntil18: null,
    canEdit: true,
    familyId: MISSING_ID,
    familyName: 'Mock Family',
    familyMemberId: null,
    ...overrides,
  }
}

type ChildMock = {
  profile?: Record<string, unknown>
  tasks?: unknown[]
  events?: unknown[]
  patch?: { status: number; body: unknown }
}

async function mockChild(page: Page, mock: ChildMock = {}) {
  const writes: Array<{ method: string; body: Record<string, unknown> | null }> = []
  await page.route(`**/api/children/${MOCK_CHILD_ID}`, async (route: Route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { profile: mockProfile(mock.profile), tasks: mock.tasks ?? [], events: mock.events ?? [] },
        }),
      })
      return
    }
    writes.push({ method: req.method(), body: req.postDataJSON() })
    const patch = mock.patch ?? { status: 200, body: { success: true } }
    await route.fulfill({ status: patch.status, contentType: 'application/json', body: JSON.stringify(patch.body) })
  })
  return writes
}

test.describe('parent', () => {
  // Needs a parent test account on the dev branch (never production).
  test.skip(!hasAccount('parent'), 'Set E2E_PARENT_EMAIL and E2E_PARENT_PASSWORD (a parent who owns a family on the dev branch)')

  test.beforeEach(async ({ page }) => {
    await signIn(page, 'parent')
  })

  test('family settings show general settings and the family name to its owner', async ({ page }) => {
    await page.goto('/family/settings', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Family Settings' })).toBeVisible()
    await expect(page.getByText('General Settings')).toBeVisible()
    const name = page.getByLabel('Family Name')
    await expect(name).toBeVisible()
    if (await name.isDisabled()) test.skip(true, 'The E2E parent does not own their family')
    await expect(page.getByText('Only the family owner can change these settings.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible()
  })

  test('deleting a family needs the exact family name typed, and cancel deletes nothing', async ({ page }) => {
    const deletes: Request[] = []
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && /\/api\/families\//.test(r.url())) deletes.push(r)
    })
    await page.goto('/family/settings', { waitUntil: 'networkidle' })
    const openDelete = page.getByRole('button', { name: 'Delete Family', exact: true })
    if ((await openDelete.count()) === 0) test.skip(true, 'The E2E parent does not own their family')

    const familyName = (await page.getByLabel('Family Name').inputValue()) || 'DELETE'
    await openDelete.click()
    const dialog = page.getByRole('dialog', { name: 'Delete this family?' })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Delete family', exact: true })
    const phrase = dialog.getByLabel(/to confirm/)

    await expect(confirm).toBeDisabled()
    await phrase.fill(`${familyName}x`)
    await expect(confirm).toBeDisabled()
    await phrase.fill(familyName.toLowerCase() === familyName ? `${familyName.toUpperCase()}!` : familyName.toLowerCase())
    await expect(confirm).toBeDisabled()
    await phrase.fill(familyName)
    await expect(confirm).toBeEnabled()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(deletes).toEqual([])
  })

  test('reopening the delete dialog starts with an empty confirmation', async ({ page }) => {
    await page.goto('/family/settings', { waitUntil: 'networkidle' })
    const openDelete = page.getByRole('button', { name: 'Delete Family', exact: true })
    if ((await openDelete.count()) === 0) test.skip(true, 'The E2E parent does not own their family')
    await openDelete.click()
    const dialog = page.getByRole('dialog', { name: 'Delete this family?' })
    await dialog.getByLabel(/to confirm/).fill('something')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await openDelete.click()
    await expect(dialog.getByLabel(/to confirm/)).toHaveValue('')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
  })

  test('an unknown child shows the not-found empty state', async ({ page }) => {
    await page.goto(`/family/child/${MISSING_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Child not found')).toBeVisible()
    await expect(page.getByText(/doesn't exist or you don't have permission/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  })

  test('a child with no tasks shows zero counts and the empty task list', async ({ page }) => {
    await mockChild(page)
    await page.goto(`/family/child/${MOCK_CHILD_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Mock Kid' })).toBeVisible()
    await expect(page.getByText('Active Tasks')).toBeVisible()
    await expect(page.getByText('Upcoming Events')).toBeVisible()
    await expect(page.getByText('Tasks assigned to Mock Kid')).toBeVisible()
    await expect(page.getByText('No tasks', { exact: true })).toBeVisible()
    await expect(page.getByText('No tasks have been assigned yet')).toBeVisible()
  })

  test('a child with tasks lists them with status and links to each task', async ({ page }) => {
    await mockChild(page, {
      profile: { grade: '4th', school: 'Maple Elementary', age: 9 },
      tasks: [
        { id: 'task-a', title: 'Feed the cat', status: 'IN_PROGRESS', priority: 'HIGH', due_date: null, category: null },
        { id: 'task-b', title: 'Read chapter 3', status: 'PENDING_APPROVAL', priority: 'LOW', due_date: '2030-01-15', category: null },
      ],
    })
    await page.goto(`/family/child/${MOCK_CHILD_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByText('4th')).toBeVisible()
    await expect(page.getByText('Maple Elementary')).toBeVisible()
    await expect(page.getByText(/Age 9/)).toBeVisible()
    const feed = page.getByRole('link', { name: /Feed the cat/ })
    await expect(feed).toHaveAttribute('href', '/tasks/task-a')
    await expect(feed.getByText('In progress')).toBeVisible()
    await expect(feed.getByText('No due date')).toBeVisible()
    const read = page.getByRole('link', { name: /Read chapter 3/ })
    await expect(read.getByText('Awaiting approval')).toBeVisible()
    await expect(read.getByText('Jan 15, 2030')).toBeVisible()
    await expect(page.getByText('No tasks have been assigned yet')).toHaveCount(0)
  })

  test('the Edit button only shows when the profile can be edited', async ({ page }) => {
    await mockChild(page, { profile: { canEdit: false } })
    await page.goto(`/family/child/${MOCK_CHILD_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Mock Kid' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
  })

  test('editing a child: an empty name is refused before anything is sent', async ({ page }) => {
    const writes = await mockChild(page)
    await page.goto(`/family/child/${MOCK_CHILD_ID}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Mock Kid' })
    await expect(dialog).toBeVisible()
    const name = dialog.getByLabel('Name', { exact: true })
    await expect(name).toHaveValue('Mock Kid')
    await name.fill('   ')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Please enter a name')).toBeVisible()
    await expect(dialog).toBeVisible()
    expect(writes).toEqual([])
  })

  test('editing a child: saving sends trimmed details and closes the dialog', async ({ page }) => {
    const writes = await mockChild(page)
    await page.goto(`/family/child/${MOCK_CHILD_ID}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Mock Kid' })
    await dialog.getByLabel('Name', { exact: true }).fill('  Mock Kiddo  ')
    await dialog.getByLabel('School').fill('  Oak Middle ')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Details saved')).toBeVisible()
    await expect(dialog).toHaveCount(0)
    expect(writes).toHaveLength(1)
    expect(writes[0].method).toBe('PATCH')
    expect(writes[0].body).toMatchObject({ displayName: 'Mock Kiddo', school: 'Oak Middle', grade: null, dateOfBirth: null })
  })

  test('editing a child: a server error is shown and the dialog stays open', async ({ page }) => {
    await mockChild(page, { patch: { status: 400, body: { success: false, error: 'That birthdate is in the future' } } })
    await page.goto(`/family/child/${MOCK_CHILD_ID}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Mock Kid' })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('That birthdate is in the future')).toBeVisible()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  })
})

test.describe('child', () => {
  // Needs a child login (a child member with their own account) on the dev branch.
  test.skip(!hasAccount('child'), 'Set E2E_CHILD_EMAIL and E2E_CHILD_PASSWORD (a child member with a login on the dev branch)')

  test.beforeEach(async ({ page }) => {
    await signIn(page, 'child')
  })

  test('family settings are read-only, with no danger zone or save button', async ({ page }) => {
    await page.goto('/family/settings', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Family Settings' })).toBeVisible()
    await expect(page.getByLabel('Family Name')).toBeDisabled()
    await expect(page.getByText('Only the family owner can change these settings.')).toBeVisible()
    await expect(page.getByText('Danger Zone')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete Family' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0)
  })

  test('an unknown child shows the not-found empty state', async ({ page }) => {
    await page.goto(`/family/child/${MISSING_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Child not found')).toBeVisible()
  })
})

test.describe('guest', () => {
  // Needs a guest member on the dev branch (joined with a GUEST invite code).
  test.skip(!hasAccount('guest'), 'Set E2E_GUEST_EMAIL and E2E_GUEST_PASSWORD (a guest member on the dev branch)')

  test.beforeEach(async ({ page }) => {
    await signIn(page, 'guest')
  })

  test('family settings are not shown to a guest', async ({ page }) => {
    await page.goto('/family/settings', { waitUntil: 'networkidle' })
    await expect(page.getByText('General Settings')).toHaveCount(0)
    await expect(page.getByLabel('Family Name')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete Family' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0)
  })

  test('the family page never asks for the member activity overview', async ({ page }) => {
    const activityCalls: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/member-activities')) activityCalls.push(r.url())
    })
    await page.goto('/family', { waitUntil: 'networkidle' })
    expect(activityCalls).toEqual([])
  })

  test('an unknown child shows the not-found empty state', async ({ page }) => {
    await page.goto(`/family/child/${MISSING_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Child not found')).toBeVisible()
  })
})
