import { test, expect } from '@playwright/test'

// Events (calendar): the event API refuses every signed-out call, and the
// event pages never show Edit, Delete, Approve or Accept to a signed-out
// visitor. The config runs this against `next dev` on the Neon dev branch
// with no sign-in and no database writes. Flows that need a signed-in parent,
// child or guest, or that create, edit or delete events, are listed below
// and skipped.

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

// Everything below needs a signed-in parent, child or guest in a seeded dev
// family, and most of it writes events. playwright.config.ts allows public
// pages only, with no sign-in and no database writes, and we have no test
// accounts. These stay skipped until the suite has seeded accounts and a
// disposable database.
test.describe('signed-in event flows (need seeded accounts)', () => {
  test('parent: creating an event with a title lands on the calendar with the event', async () => {
    // Needs a signed-in parent. It POSTs /api/events (a database write).
    test.skip(true, 'needs a signed-in parent account and database writes')
  })

  test('new event: an empty title shows "Please enter an event title"', async () => {
    // Needs a signed-in member to reach /calendar/new.
    test.skip(true, 'needs a signed-in account to open /calendar/new')
  })

  test('new event: an end before the start shows "The end time must be after the start time"', async () => {
    test.skip(true, 'needs a signed-in account to open /calendar/new')
  })

  test('new event: custom repeat with no weekday shows "Pick at least one day of the week for the custom repeat"', async () => {
    test.skip(true, 'needs a signed-in account on a plan with advanced recurrence')
  })

  test('edit event: clearing the title shows "Please enter an event title"', async () => {
    test.skip(true, 'needs a signed-in parent and an existing seeded event')
  })

  test('parent sees Edit and Delete on any family event; child sees neither on a parent\'s event', async () => {
    // canManage is true only for the creator or a PARENT (GET /api/events/[id]).
    test.skip(true, 'needs seeded parent and child accounts plus a seeded event')
  })

  test('parent sees "This event is waiting for your approval." with Approve and Decline on a pending event', async () => {
    test.skip(true, 'needs a seeded PENDING event and a signed-in parent')
  })

  test('child invited to an event sees Accept and Decline; a parent does not', async () => {
    test.skip(true, 'needs a seeded event with a child participant in INVITED status')
  })

  test('guest gets 404 for a family event they were not invited to', async () => {
    test.skip(true, 'needs a signed-in guest account and a seeded family event')
  })

  test('child and guest get the "Import isn\'t available" empty state on /calendar/import', async () => {
    // useSmartImport returns no status for children and guests (the route answers 403).
    test.skip(true, 'needs signed-in child and guest accounts')
  })

  test('calendar agenda with no events in the month shows its empty state', async () => {
    test.skip(true, 'needs a signed-in account in a family with no events this month')
  })
})
