import { test, expect, type Browser, type Page } from '@playwright/test'
import { signInWithState } from '../helpers/auth'

// Events (calendar): the event API refuses every signed-out call, and the
// event pages never show Edit, Delete, Approve or Accept to a signed-out
// visitor. Those checks always run, with no sign-in and no database writes.
//
// The signed-in checks at the bottom use the saved sessions written by
// scripts/e2e-seed.mjs (dev branch accounts only, never production):
//   E2E_PARENT_STATE    a PARENT (owner) in the seeded family (+ E2E_PARENT_FAMILY_ID)
//   E2E_CHILD_STATE     a CHILD with a login in that family ("Seed Kid")
//   E2E_GUEST_STATE     a GUEST in that family ("Seed Guest")
// Checks that create events also need E2E_ALLOW_WRITES=1. They use a unique
// title and delete the event afterwards (a parent deletes, since only the
// creator or a parent may).
const PARENT_STATE = process.env.E2E_PARENT_STATE
const CHILD_STATE = process.env.E2E_CHILD_STATE
const GUEST_STATE = process.env.E2E_GUEST_STATE
const PARENT_FAMILY_ID = process.env.E2E_PARENT_FAMILY_ID
const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === '1'

// A well-formed id that matches no event, so nothing real is read or touched.
const NO_EVENT = '00000000-0000-4000-8000-000000000000'
const NO_COMMENT = '00000000-0000-4000-8000-000000000001'
const NO_FAMILY = '00000000-0000-4000-8000-000000000002'

// A body that would pass validation if the caller were signed in. It proves
// that the 401 comes from the auth check, not from the schema.
const VALID_EVENT = {
  familyId: NO_FAMILY,
  title: 'E2E should never be saved',
  startTime: '2030-01-01T10:00:00Z',
  endTime: '2030-01-01T11:00:00Z',
}

const SIGNED_OUT_CALLS: Array<{ name: string; method: 'get' | 'post' | 'patch' | 'delete'; path: string; data?: unknown }> = [
  { name: 'list events', method: 'get', path: '/api/events' },
  { name: 'list a family\'s events', method: 'get', path: `/api/events?familyId=${NO_FAMILY}` },
  { name: 'create an event', method: 'post', path: '/api/events', data: VALID_EVENT },
  { name: 'read one event', method: 'get', path: `/api/events/${NO_EVENT}` },
  { name: 'edit an event', method: 'patch', path: `/api/events/${NO_EVENT}`, data: { title: 'E2E should never be saved' } },
  { name: 'approve an event', method: 'post', path: `/api/events/${NO_EVENT}/approve`, data: { action: 'APPROVE' } },
  { name: 'reject an event', method: 'post', path: `/api/events/${NO_EVENT}/approve`, data: { action: 'REJECT' } },
  { name: 'accept an invitation', method: 'post', path: `/api/events/${NO_EVENT}/respond`, data: { action: 'ACCEPT' } },
  { name: 'decline an invitation', method: 'post', path: `/api/events/${NO_EVENT}/respond`, data: { action: 'DECLINE' } },
  { name: 'read comments', method: 'get', path: `/api/events/${NO_EVENT}/comments` },
  { name: 'post a comment', method: 'post', path: `/api/events/${NO_EVENT}/comments`, data: { body: 'E2E should never be saved' } },
  { name: 'delete a comment', method: 'delete', path: `/api/events/${NO_EVENT}/comments/${NO_COMMENT}` },
]

test.describe('event API when signed out', () => {
  for (const call of SIGNED_OUT_CALLS) {
    test(`${call.name}: ${call.method.toUpperCase()} ${call.path} answers 401 and leaks nothing`, async ({ request }) => {
      const res = await request[call.method](call.path, {
        headers: { cookie: '' },
        ...(call.data !== undefined ? { data: call.data } : {}),
      })
      expect(res.status(), `${call.method.toUpperCase()} ${call.path} status`).toBe(401)
      const json = await res.json()
      expect(json.success).toBe(false)
      expect(typeof json.error).toBe('string')
      expect(json.error.length).toBeGreaterThan(0)
      expect(json).not.toHaveProperty('data')
      expect(json).not.toHaveProperty('event')
    })
  }

  test('archive past events: no access_token cookie answers 401 Unauthorized', async ({ request }) => {
    const res = await request.post('/api/events/archive', {
      headers: { cookie: '' },
      data: { familyId: NO_FAMILY, action: 'archive_past' },
    })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  test('archive past events: a forged access_token answers 401 Invalid token', async ({ request }) => {
    const res = await request.post('/api/events/archive', {
      headers: { cookie: 'access_token=not-a-real-token' },
      data: { familyId: NO_FAMILY, action: 'archive_past' },
    })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid token' })
  })
})

test.describe('event pages when signed out', () => {
  // A signed-out visitor either goes to /login or gets the page's own
  // "Event not found" empty state (the event API answers 401). Either way,
  // they never get the manage, approve or RSVP controls.
  for (const path of [`/calendar/event/${NO_EVENT}`, `/calendar/event/${NO_EVENT}/edit`]) {
    test(`${path} shows login or "Event not found", never manage controls`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'networkidle' })
      expect(res?.status(), `${path} HTTP status`).toBeLessThan(500)
      await expect(
        page.locator('input[type="email"]').or(page.getByText('Event not found')).first()
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Save/ })).toHaveCount(0)
    })
  }
})

// ---------------------------------------------------------------------------
// Signed-in helpers
// ---------------------------------------------------------------------------

const uniqueTitle = (who: string) => `e2e ${who} event ${Date.now()}-${Math.floor(Math.random() * 1e6)}`

// Two days ahead at 15:00-16:00 UTC: always in the future, never past the
// plan's history window, with an explicit offset as the API requires.
function futureSlot() {
  const start = new Date(Date.now() + 2 * 24 * 3600 * 1000)
  start.setUTCHours(15, 0, 0, 0)
  const end = new Date(start.getTime() + 3600 * 1000)
  return { startTime: start.toISOString(), endTime: end.toISOString() }
}

// Tomorrow in the browser's own time zone (yyyy-MM-dd), the format /calendar/new?date= reads.
const browserTomorrow = (page: Page) =>
  page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })

const dayBefore = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - 1))
  return dt.toISOString().slice(0, 10)
}

// Finds an event by title through the API, using the page's signed-in cookies.
async function eventIdByTitle(page: Page, familyId: string, title: string): Promise<string | undefined> {
  const res = await page.request.get(`/api/events?familyId=${familyId}`)
  if (!res.ok()) return undefined
  const body = (await res.json()) as { data?: Array<{ id: string; title: string }> }
  return (body.data || []).find((e) => e.title === title)?.id
}

// Creates an event through POST /api/events and returns its id.
async function createEvent(page: Page, familyId: string, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/events', { data: { familyId, ...futureSlot(), ...data } })
  expect(res.ok(), `POST /api/events: ${res.status()} ${await res.text()}`).toBe(true)
  const body = await res.json()
  const id: string | undefined = body?.data?.id ?? body?.event?.id ?? (await eventIdByTitle(page, familyId, data.title as string))
  expect(id, 'id of the new event').toBeTruthy()
  return id as string
}

// Opens a second, independent browser context signed in as another role.
async function asRole(browser: Browser, role: 'parent' | 'child' | 'guest') {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signInWithState(page, role)
  return { ctx, page }
}

// The user id inside the page's access_token cookie (a JWT carrying userId).
async function userIdOf(page: Page): Promise<string> {
  const token = (await page.context().cookies()).find((c) => c.name === 'access_token')?.value
  expect(token, 'access_token cookie').toBeTruthy()
  const payload = JSON.parse(Buffer.from((token as string).split('.')[1], 'base64url').toString('utf8'))
  const id = payload.userId ?? payload.sub
  expect(id, 'userId in the access token').toBeTruthy()
  return id as string
}

// The /calendar/new form, located by its title field.
const newEventForm = (page: Page) => page.locator('form').filter({ has: page.getByLabel(/Event Title/) }).first()

test.describe('signed-in event flows (need seeded accounts)', () => {
  test('parent: creating an event with a title lands on the calendar with the event', async ({ page }) => {
    test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    await signInWithState(page, 'parent')
    const title = uniqueTitle('parent')
    try {
      const day = await browserTomorrow(page)
      // ?date= starts the form at 12:00-13:00 that day, so the times are fixed.
      await page.goto(`/calendar/new?date=${day}`, { waitUntil: 'networkidle' })
      const titleInput = page.getByLabel(/Event Title/)
      await expect(titleInput).toBeVisible()
      await titleInput.fill(title)

      const posted = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/events',
      )
      await page.getByRole('button', { name: /create/i }).first().click()
      const res = await posted
      expect(res.ok(), `POST /api/events status ${res.status()}`).toBe(true)
      await expect(page).not.toHaveURL(/\/calendar\/new/)

      await page.goto(`/calendar?date=${day}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(title).first()).toBeVisible()
    } finally {
      const id = await eventIdByTitle(page, PARENT_FAMILY_ID as string, title)
      if (id) await page.request.delete(`/api/events/${id}`)
    }
  })

  test('new event: an empty title shows "Please enter an event title"', async ({ page }) => {
    test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
    await signInWithState(page, 'parent')
    await page.goto('/calendar/new', { waitUntil: 'networkidle' })
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/events') posts.push(r.url())
    })
    const titleInput = page.getByLabel(/Event Title/)
    await expect(titleInput).toBeVisible()
    // Only spaces: past any browser "required" check, empty once trimmed.
    await titleInput.fill('   ')
    await page.getByRole('button', { name: /create/i }).first().click()
    await expect(page.getByText('Please enter an event title')).toBeVisible()
    await expect(page).toHaveURL(/\/calendar\/new/)
    expect(posts).toEqual([])
  })

  test('new event: an end before the start shows "The end time must be after the start time"', async ({ page }) => {
    test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
    await signInWithState(page, 'parent')
    const day = await browserTomorrow(page)
    await page.goto(`/calendar/new?date=${day}`, { waitUntil: 'networkidle' })
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/events') posts.push(r.url())
    })
    await page.getByLabel(/Event Title/).fill(uniqueTitle('backwards'))
    await page.locator('#endDate').fill(dayBefore(day))
    // Let the page's own check run even if the end date input carries a min.
    await newEventForm(page).evaluate((f) => { (f as HTMLFormElement).noValidate = true })
    await page.getByRole('button', { name: /create/i }).first().click()
    await expect(page.getByText('The end time must be after the start time')).toBeVisible()
    await expect(page).toHaveURL(/\/calendar\/new/)
    expect(posts).toEqual([])
  })

  test('new event: custom repeat with no weekday shows "Pick at least one day of the week for the custom repeat"', async () => {
    test.skip(
      true,
      'the repeat controls of /calendar/new (switch and rule select) and the subscription response hooks/use-subscription reads for advancedRecurrence are not in the available source, so they cannot be located or mocked without guessing',
    )
  })

  test('edit event: clearing the title shows "Please enter an event title"', async ({ page }) => {
    test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    await signInWithState(page, 'parent')
    const title = uniqueTitle('edit')
    let id: string | undefined
    try {
      id = await createEvent(page, PARENT_FAMILY_ID as string, { title })
      await page.goto(`/calendar/event/${id}/edit`, { waitUntil: 'domcontentloaded' })
      const titleInput = page.getByLabel(/Event Title/)
      await expect(titleInput).toHaveValue(title)

      const patches: string[] = []
      page.on('request', (r) => {
        if (r.method() === 'PATCH' && r.url().includes(`/api/events/${id}`)) patches.push(r.url())
      })
      await titleInput.fill('')
      await page.getByRole('button', { name: /Save/ }).click()
      await expect(page.getByText('Please enter an event title')).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`/calendar/event/${id}/edit`))
      expect(patches).toEqual([])

      // The title on the server is unchanged.
      const res = await page.request.get(`/api/events/${id}`)
      expect(res.status()).toBe(200)
      expect((await res.json()).event.title).toBe(title)
    } finally {
      if (id) await page.request.delete(`/api/events/${id}`)
    }
  })

  test('parent sees Edit and Delete on any family event; child sees neither on a parent\'s event', async ({ page, browser }) => {
    // canManage is true only for the creator or a PARENT (GET /api/events/[id]).
    test.skip(!PARENT_STATE || !CHILD_STATE, 'E2E_PARENT_STATE and E2E_CHILD_STATE needed')
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    await signInWithState(page, 'parent')
    const title = uniqueTitle('manage')
    let id: string | undefined
    const child = await asRole(browser, 'child')
    try {
      id = await createEvent(page, PARENT_FAMILY_ID as string, { title, visibility: 'FAMILY' })

      await page.goto(`/calendar/event/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(title).first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', `/calendar/event/${id}/edit`)
      await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()

      const childApi = await child.page.request.get(`/api/events/${id}`)
      expect(childApi.status()).toBe(200)
      expect((await childApi.json()).event.canManage).toBe(false)

      await child.page.goto(`/calendar/event/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(child.page.getByText(title).first()).toBeVisible()
      await expect(child.page.getByRole('link', { name: 'Edit' })).toHaveCount(0)
      await expect(child.page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
    } finally {
      await child.ctx.close()
      if (id) await page.request.delete(`/api/events/${id}`)
    }
  })

  test('parent sees "This event is waiting for your approval." with Approve and Decline on a pending event', async ({ page, browser }) => {
    test.skip(!PARENT_STATE || !CHILD_STATE, 'E2E_PARENT_STATE and E2E_CHILD_STATE needed')
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    await signInWithState(page, 'parent')
    const title = uniqueTitle('pending')
    let id: string | undefined
    const child = await asRole(browser, 'child')
    try {
      // A child's "Ask a parent" request waits for a parent's approval.
      id = await createEvent(child.page, PARENT_FAMILY_ID as string, { title, askParent: true })
      const childView = await child.page.request.get(`/api/events/${id}`)
      expect(childView.status()).toBe(200)
      expect((await childView.json()).event.status).toBe('PENDING')

      await page.goto(`/calendar/event/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(title).first()).toBeVisible()
      await expect(page.getByText('This event is waiting for your approval.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible()
      await expect(page.getByText('Pending Approval')).toBeVisible()

      // The child who asked gets no Approve button on their own request.
      await child.page.goto(`/calendar/event/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(child.page.getByText(title).first()).toBeVisible()
      await expect(child.page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    } finally {
      await child.ctx.close()
      if (!id) id = await eventIdByTitle(page, PARENT_FAMILY_ID as string, title)
      if (id) await page.request.delete(`/api/events/${id}`)
    }
  })

  test('child invited to an event sees Accept and Decline; a parent does not', async ({ page, browser }) => {
    test.skip(!PARENT_STATE || !CHILD_STATE, 'E2E_PARENT_STATE and E2E_CHILD_STATE needed')
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    await signInWithState(page, 'parent')
    const title = uniqueTitle('invite')
    let id: string | undefined
    const child = await asRole(browser, 'child')
    try {
      const childUserId = await userIdOf(child.page)
      id = await createEvent(page, PARENT_FAMILY_ID as string, {
        title,
        visibility: 'FAMILY',
        participants: [{ userId: childUserId }],
      })

      const childView = await child.page.request.get(`/api/events/${id}`)
      expect(childView.status()).toBe(200)
      const event = (await childView.json()).event
      const me = (event.participants as Array<{ userId: string | null; status: string }>).find((p) => p.userId === childUserId)
      expect(me, 'the child is a participant').toBeTruthy()
      expect(me?.status).toBe('INVITED')

      await child.page.goto(`/calendar/event/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(child.page.getByText(title).first()).toBeVisible()
      await expect(child.page.getByText("You've been invited to this event.")).toBeVisible()
      await expect(child.page.getByRole('button', { name: 'Accept' })).toBeVisible()
      await expect(child.page.getByRole('button', { name: 'Decline' })).toBeVisible()

      await page.goto(`/calendar/event/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(title).first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible()
      await expect(page.getByText("You've been invited to this event.")).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    } finally {
      await child.ctx.close()
      if (id) await page.request.delete(`/api/events/${id}`)
    }
  })

  test('guest gets 404 for a family event they were not invited to', async ({ page, browser }) => {
    test.skip(!PARENT_STATE || !GUEST_STATE, 'E2E_PARENT_STATE and E2E_GUEST_STATE needed')
    test.skip(!PARENT_FAMILY_ID, 'E2E_PARENT_FAMILY_ID not set')
    test.skip(!ALLOW_WRITES, 'writes to the dev database: set E2E_ALLOW_WRITES=1')
    await signInWithState(page, 'parent')
    const title = uniqueTitle('not-for-guest')
    let id: string | undefined
    const guest = await asRole(browser, 'guest')
    try {
      id = await createEvent(page, PARENT_FAMILY_ID as string, { title, visibility: 'FAMILY' })

      const res = await guest.page.request.get(`/api/events/${id}`)
      expect(res.status()).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Event not found or access denied')
      expect(body).not.toHaveProperty('event')

      await guest.page.goto(`/calendar/event/${id}`, { waitUntil: 'domcontentloaded' })
      await expect(guest.page.getByText('Event not found')).toBeVisible()
      await expect(guest.page.getByText(title)).toHaveCount(0)
      await expect(guest.page.getByRole('link', { name: 'Edit' })).toHaveCount(0)
      await expect(guest.page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
    } finally {
      await guest.ctx.close()
      if (id) await page.request.delete(`/api/events/${id}`)
    }
  })

  test('child and guest get the "Import isn\'t available" empty state on /calendar/import', async ({ page, browser }) => {
    // useSmartImport returns no status for children and guests (the route answers 403).
    test.skip(!CHILD_STATE || !GUEST_STATE, 'E2E_CHILD_STATE and E2E_GUEST_STATE needed')
    await signInWithState(page, 'child')
    await page.goto('/calendar/import', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText("Import isn't available")).toBeVisible()
    await expect(page.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/calendar/new')
    await expect(page.getByRole('button', { name: /Choose a photo/ })).toHaveCount(0)

    const guest = await asRole(browser, 'guest')
    try {
      await guest.page.goto('/calendar/import', { waitUntil: 'domcontentloaded' })
      await expect(guest.page.getByText("Import isn't available")).toBeVisible()
      await expect(guest.page.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/calendar/new')
      await expect(guest.page.getByRole('button', { name: /Choose a photo/ })).toHaveCount(0)
    } finally {
      await guest.ctx.close()
    }
  })

  test('calendar agenda with no events in the month shows its empty state', async ({ page }) => {
    test.skip(!PARENT_STATE, 'E2E_PARENT_STATE (signed-in parent storageState) not set')
    await signInWithState(page, 'parent')
    // A month far ahead that no test or seed ever puts events in.
    await page.goto('/calendar?date=2099-06-15', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'June 2099' })).toBeVisible()
    const agenda = page.getByRole('tab', { name: 'Agenda' })
    await agenda.click()
    await expect(agenda).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'June 2099' })).toBeVisible()
    await expect(page.locator('a[href^="/calendar/event/"]')).toHaveCount(0)
  })
})