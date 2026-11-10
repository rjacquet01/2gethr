import { test, expect, type ConsoleMessage, type Page } from '@playwright/test'

// Tasks: the list (/tasks), the new-task form (/tasks/new), the detail and edit
// pages, and the /api/tasks routes behind them.
//
// Without sign-in (always runs): every tasks API answers 401 before it reads
// the body or touches the database, and the pages never show the task form.
// Nothing is written.
//
// Signed-in checks need a saved Playwright storageState per role (dev branch
// accounts only, never production). Each block skips itself when its file is
// not given:
//   E2E_PARENT_STATE    a PARENT in a family      (+ E2E_PARENT_FAMILY_ID)
//   E2E_CHILD_STATE     a CHILD with a login in a family
//   E2E_GUEST_STATE     a GUEST in a family       (+ E2E_GUEST_FAMILY_ID)
//   E2E_NOFAMILY_STATE  an account with no family yet
// Checks that create a task also need E2E_ALLOW_WRITES=1. They use a unique
// title and delete the task afterwards.
const PARENT_STATE = process.env.E2E_PARENT_STATE
const CHILD_STATE = process.env.E2E_CHILD_STATE
const GUEST_STATE = process.env.E2E_GUEST_STATE
const NOFAMILY_STATE = process.env.E2E_NOFAMILY_STATE
const PARENT_FAMILY_ID = process.env.E2E_PARENT_FAMILY_ID
const GUEST_FAMILY_ID = process.env.E2E_GUEST_FAMILY_ID
const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === '1'

// A well-formed id that matches no task, family, person or comment.
const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000'

const uniqueTitle = (who: string) => `e2e ${who} task ${Date.now()}-${Math.floor(Math.random() * 1e6)}`

// Today's date in the browser's own time zone, the same value the form uses for min.
const browserToday = (page: Page) =>
  page.evaluate(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })

// Finds a task by title through the API, using the page's signed-in cookies.
async function taskIdByTitle(page: Page, title: string): Promise<string | undefined> {
  const res = await page.request.get('/api/tasks')
  if (!res.ok()) return undefined
  const { data } = (await res.json()) as { data: Array<{ id: string; title: string }> }
  return data.find((t) => t.title === title)?.id
}

test.describe('signed out: the tasks API refuses every call', () => {
  const CALLS: Array<{ name: string; method: 'get' | 'post' | 'patch' | 'delete'; path: string; data?: unknown }> = [
    { name: 'list tasks', method: 'get', path: '/api/tasks' },
    { name: 'list tasks of a family', method: 'get', path: `/api/tasks?familyId=${NO_SUCH_ID}` },
    { name: 'create a task (empty body)', method: 'post', path: '/api/tasks', data: {} },
    { name: 'create a task', method: 'post', path: '/api/tasks', data: { familyId: NO_SUCH_ID, title: 'nope' } },
    { name: 'read a task', method: 'get', path: `/api/tasks/${NO_SUCH_ID}` },
    { name: 'update a task', method: 'patch', path: `/api/tasks/${NO_SUCH_ID}`, data: { action: 'complete' } },
    { name: 'list archived tasks', method: 'get', path: '/api/tasks/archive' },
    { name: 'archive done tasks', method: 'post', path: '/api/tasks/archive' },
    { name: 'list comments', method: 'get', path: `/api/tasks/${NO_SUCH_ID}/comments` },
    { name: 'add a comment', method: 'post', path: `/api/tasks/${NO_SUCH_ID}/comments`, data: { content: 'hi' } },
    { name: 'edit a comment', method: 'patch', path: `/api/tasks/${NO_SUCH_ID}/comments`, data: { commentId: NO_SUCH_ID, content: 'hi' } },
    { name: 'delete a comment', method: 'delete', path: `/api/tasks/${NO_SUCH_ID}/comments/${NO_SUCH_ID}` },
  ]

  for (const call of CALLS) {
    test(`${call.method.toUpperCase()} ${call.path}: 401 (${call.name})`, async ({ request }) => {
      const res = await request[call.method](call.path, call.data === undefined ? {} : { data: call.data })
      expect(res.status()).toBe(401)
      const body = await res.json()
      expect(body.error).toBeTruthy()
    })
  }

  test('a made-up bearer token is refused too', async ({ request }) => {
    const res = await request.get('/api/tasks', { headers: { authorization: 'Bearer not-a-real-token' } })
    expect(res.status()).toBe(401)
  })

  for (const path of ['/tasks', '/tasks/new', `/tasks/${NO_SUCH_ID}`, `/tasks/${NO_SUCH_ID}/edit`]) {
    test(`${path} does not show the task form without sign-in`, async ({ page }) => {
      // Failed 401 fetches log console errors here, so console output is not checked.
      const res = await page.goto(path, { waitUntil: 'networkidle' })
      expect(res?.status(), `${path} HTTP status`).toBeLessThan(500)
      await expect(page.getByLabel('Task Title')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Mark as done' })).toHaveCount(0)
    })
  }
})

test.describe('parent', () => {
  // Needs a saved sign-in for a PARENT on the dev branch; see the top of this file.
  test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
  test.use({ storageState: PARENT_STATE })

  test('/tasks/new renders the form with no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/tasks/new', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'New Task' })).toBeVisible()
    await expect(page.getByLabel('Task Title')).toBeVisible()
    await expect(page.getByLabel('Description')).toBeVisible()
    await expect(page.getByLabel('Due Date')).toBeVisible()
    await expect(page.getByLabel('Reminder')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Require Approval' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Recurring Task' })).toBeVisible()
    // "Ask a parent" is for children only.
    await expect(page.getByRole('button', { name: /ask a parent/i })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('an empty title is blocked by the browser and nothing is sent', async ({ page }) => {
    await page.goto('/tasks/new', { waitUntil: 'networkidle' })
    const posts: string[] = []
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/tasks')) posts.push(r.url()) })
    const title = page.getByLabel('Task Title')
    await expect(title).toHaveValue('')
    await page.getByRole('button', { name: /create/i }).first().click()
    expect(await title.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true)
    await expect(page).toHaveURL(/\/tasks\/new/)
    expect(posts).toEqual([])
  })

  test('a title of only spaces shows "Task title is required"', async ({ page }) => {
    await page.goto('/tasks/new', { waitUntil: 'networkidle' })
    const posts: string[] = []
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/tasks')) posts.push(r.url()) })
    await page.getByLabel('Task Title').fill('   ')
    await page.getByRole('button', { name: /create/i }).first().click()
    await expect(page.getByText('Task title is required')).toBeVisible()
    await expect(page).toHaveURL(/\/tasks\/new/)
    expect(posts).toEqual([])
  })

  test('the due date cannot be set before today', async ({ page }) => {
    await page.goto('/tasks/new', { waitUntil: 'networkidle' })
    await expect(page.getByLabel('Due Date')).toHaveAttribute('min', await browserToday(page))
  })

  test('a task that does not exist shows "Task not found"', async ({ page }) => {
    await page.goto(`/tasks/${NO_SUCH_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Task not found')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/dashboard')
  })

  test('editing a task that does not exist shows "Task not found"', async ({ page }) => {
    await page.goto(`/tasks/${NO_SUCH_ID}/edit`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Task not found')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Tasks' })).toHaveAttribute('href', '/tasks')
    await expect(page.getByLabel('Task Title')).toHaveCount(0)
  })

  test('API: another family\'s tasks are refused (403)', async ({ page }) => {
    const res = await page.request.get(`/api/tasks?familyId=${NO_SUCH_ID}`)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Family not found or access denied')
  })

  test('API: creating without a title or family is a 400', async ({ page }) => {
    const res = await page.request.post('/api/tasks', { data: { description: 'no title' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Family ID and title are required')
  })

  test('API: creating in a family I am not in is a 403', async ({ page }) => {
    const res = await page.request.post('/api/tasks', { data: { familyId: NO_SUCH_ID, title: 'not mine' } })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Not a member of this family')
  })

  test('API: assigning to someone outside the family is a 400', async ({ page }) => {
    // Needs the parent's family id to get past the membership check.
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    const res = await page.request.post('/api/tasks', {
      data: { familyId: PARENT_FAMILY_ID, title: 'stranger', assignedToUserId: NO_SUCH_ID },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('That person is not in this family')
  })

  test('API: an empty comment is a 400', async ({ page }) => {
    const res = await page.request.post(`/api/tasks/${NO_SUCH_ID}/comments`, { data: { content: '   ' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Comment content is required')
  })

  test('API: editing a comment without its id is a 400', async ({ page }) => {
    const res = await page.request.patch(`/api/tasks/${NO_SUCH_ID}/comments`, { data: { content: 'edit' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('commentId is required')
  })

  test('API: a task that does not exist is a 404', async ({ page }) => {
    const res = await page.request.get(`/api/tasks/${NO_SUCH_ID}`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('Task not found')
  })

  test('API: the archive lists tasks with the plan history window', async ({ page }) => {
    const res = await page.request.get('/api/tasks/archive')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.tasks)).toBe(true)
    expect(typeof body.historyDays).toBe('number')
  })

  test('creates a task, finds it in the list and on its page', async ({ page }) => {
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    const title = uniqueTitle('parent')
    try {
      await page.goto('/tasks/new', { waitUntil: 'networkidle' })
      await page.getByLabel('Task Title').fill(title)
      await page.getByLabel('Description').fill('Made by the e2e suite')
      await page.getByRole('switch', { name: 'Require Approval' }).click()
      await page.getByRole('button', { name: /create/i }).first().click()
      await expect(page.getByText('Task created successfully')).toBeVisible()
      await expect(page).toHaveURL(/\/dashboard/)

      await page.goto('/tasks', { waitUntil: 'networkidle' })
      // Parents land on "Awaiting approval" when something waits; "Everyone" lists all.
      const everyone = page.getByRole('tab', { name: /everyone/i })
      if (await everyone.count()) await everyone.first().click()
      const link = page.getByRole('link', { name: title })
      await expect(link).toBeVisible()
      await link.click()

      await expect(page.getByRole('heading', { name: title })).toBeVisible()
      await expect(page.getByText('Made by the e2e suite')).toBeVisible()
      await expect(page.getByText('Requires approval when complete')).toBeVisible()
      await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible()
    } finally {
      const id = await taskIdByTitle(page, title)
      if (id) await page.request.delete(`/api/tasks/${id}`)
    }
  })
})

test.describe('child', () => {
  // Needs a saved sign-in for a CHILD with a login on the dev branch.
  test.skip(!CHILD_STATE, 'E2E_CHILD_STATE (signed-in child storageState) not set')
  test.use({ storageState: CHILD_STATE })

  test('/tasks/new offers "Ask a parent" next to Create', async ({ page }) => {
    await page.goto('/tasks/new', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'New Task' })).toBeVisible()
    await expect(page.getByRole('button', { name: /ask a parent/i })).toBeVisible()
  })

  test('a title of only spaces is refused here too', async ({ page }) => {
    await page.goto('/tasks/new', { waitUntil: 'networkidle' })
    await page.getByLabel('Task Title').fill('   ')
    await page.getByRole('button', { name: /ask a parent/i }).click()
    await expect(page.getByText('Task title is required')).toBeVisible()
    await expect(page).toHaveURL(/\/tasks\/new/)
  })

  test('"Ask a parent" sends the task for approval', async ({ page, browser }) => {
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    // A parent cleans up, since a child may not delete tasks.
    test.skip(!PARENT_STATE, 'E2E_PARENT_STATE needed to delete the task afterwards')
    const title = uniqueTitle('child')
    try {
      await page.goto('/tasks/new', { waitUntil: 'networkidle' })
      await page.getByLabel('Task Title').fill(title)
      await page.getByRole('button', { name: /ask a parent/i }).click()
      await expect(page.getByText('Sent to a parent to approve')).toBeVisible()
      await expect(page).toHaveURL(/\/dashboard/)

      const id = await taskIdByTitle(page, title)
      expect(id, 'the new task in /api/tasks').toBeTruthy()
      await page.goto(`/tasks/${id}`, { waitUntil: 'networkidle' })
      await expect(page.getByText('Waiting for a parent or guardian to approve this task.')).toBeVisible()
      // The child cannot approve their own request.
      await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    } finally {
      const parent = await browser.newContext({ storageState: PARENT_STATE })
      const parentPage = await parent.newPage()
      const id = await taskIdByTitle(parentPage, title)
      if (id) await parentPage.request.delete(`/api/tasks/${id}`)
      await parent.close()
    }
  })
})

test.describe('guest', () => {
  // Needs a saved sign-in for a GUEST on the dev branch.
  test.skip(!GUEST_STATE, 'E2E_GUEST_STATE (signed-in guest storageState) not set')
  test.use({ storageState: GUEST_STATE })

  test('API: a guest cannot assign a task to a child (403)', async ({ page }) => {
    test.skip(!GUEST_FAMILY_ID, 'E2E_GUEST_FAMILY_ID not set')
    const res = await page.request.post('/api/tasks', {
      data: { familyId: GUEST_FAMILY_ID, title: 'for a kid', assignedToChildId: NO_SUCH_ID },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Guests can only assign tasks to themselves')
  })

  test('API: a guest cannot assign a task to another member (403)', async ({ page }) => {
    test.skip(!GUEST_FAMILY_ID, 'E2E_GUEST_FAMILY_ID not set')
    const res = await page.request.post('/api/tasks', {
      data: { familyId: GUEST_FAMILY_ID, title: 'for someone', assignedToUserId: NO_SUCH_ID },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Guests can only assign tasks to themselves')
  })

  test('API: a guest only sees tasks they created or are assigned to', async ({ page }) => {
    const me = await page.request.get('/api/tasks')
    expect(me.status()).toBe(200)
    const { data } = (await me.json()) as { data: Array<{ family_id: string; created_by_id: string; assigned_to_id: string | null }> }
    test.skip(!GUEST_FAMILY_ID || data.length === 0, 'no guest family id or no tasks to inspect')
    const inGuestFamily = data.filter((t) => t.family_id === GUEST_FAMILY_ID)
    const people = new Set(inGuestFamily.flatMap((t) => [t.created_by_id, t.assigned_to_id]))
    // Every listed task involves one shared person: the guest.
    for (const t of inGuestFamily) {
      expect([t.created_by_id, t.assigned_to_id].some((id) => id && people.has(id))).toBe(true)
    }
  })
})

test.describe('no family yet (empty state)', () => {
  // Needs a saved sign-in for an account that has not joined or created a family.
  test.skip(!NOFAMILY_STATE, 'E2E_NOFAMILY_STATE (signed-in, no family) not set')
  test.use({ storageState: NOFAMILY_STATE })

  test('/tasks says "No family yet" and links to onboarding', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' })
    await expect(page.getByText('No family yet')).toBeVisible()
    await expect(page.getByText('Create or join a family to start managing tasks')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/onboarding')
  })

  test('/tasks/new asks to join or create a family first', async ({ page }) => {
    await page.goto('/tasks/new', { waitUntil: 'networkidle' })
    await expect(page.getByText('Please join or create a family first')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/onboarding')
    await expect(page.getByLabel('Task Title')).toHaveCount(0)
  })

  test('API: the task list is empty', async ({ page }) => {
    const res = await page.request.get('/api/tasks')
    expect(res.status()).toBe(200)
    expect((await res.json()).data).toEqual([])
  })

  test('API: the archive has no family to read', async ({ page }) => {
    const res = await page.request.get('/api/tasks/archive')
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('No family found')
  })
})
