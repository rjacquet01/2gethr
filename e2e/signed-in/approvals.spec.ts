import { test, expect, type APIRequestContext } from '@playwright/test'

// Signed-in API specs. They create throwaway accounts on whatever database
// .env.local points at (the Neon dev branch), so never run them against
// production. Every account uses an @example.com address and no email/SMS keys
// are set locally, so nothing is sent.

const stamp = Date.now()
const PASSWORD = 'E2eTest-Pass1'
const parentEmail = `e2e.parent.${stamp}@example.com`
const childEmail = `e2e.child.${stamp}@example.com`

type Tokens = { accessToken: string; refreshToken: string }

function tokensFrom(body: any): Tokens {
  const t = body?.data?.tokens ?? body?.tokens
  if (!t?.accessToken) throw new Error('No tokens in response: ' + JSON.stringify(body).slice(0, 300))
  return t
}

const auth = (t: Tokens) => ({ Authorization: `Bearer ${t.accessToken}` })

async function register(request: APIRequestContext, email: string, first: string) {
  const res = await request.post('/api/auth/register', {
    data: {
      email,
      password: PASSWORD,
      firstName: first,
      lastName: 'E2E',
      ageConfirmed: true,
      termsAccepted: true,
    },
  })
  expect(res.status(), await res.text()).toBeLessThan(300)
  return tokensFrom(await res.json())
}

async function login(request: APIRequestContext, email: string, password = PASSWORD) {
  const res = await request.post('/api/auth/login', { data: { email, password } })
  expect(res.status(), await res.text()).toBe(200)
  return tokensFrom(await res.json())
}

test.describe.serial('signed-in approval flows', () => {
  let parent: Tokens
  let child: Tokens
  let familyId: string

  test('set up a parent, a family and a child with a login', async ({ request }) => {
    parent = await register(request, parentEmail, 'Parent')

    const fam = await request.post('/api/families', {
      headers: auth(parent),
      data: { name: `E2E Family ${stamp}` },
    })
    expect(fam.status(), await fam.text()).toBeLessThan(300)
    familyId = (await fam.json()).data.id
    expect(familyId).toBeTruthy()

    const kid = await request.post(`/api/families/${familyId}/children`, {
      headers: auth(parent),
      data: { displayName: 'E2E Kid', age: 12, consent: true, createAccount: true, email: childEmail, password: PASSWORD },
    })
    expect(kid.status(), await kid.text()).toBeLessThan(300)

    child = await login(request, childEmail)
  })

  test('a child cannot restore an approval-required task a parent archived', async ({ request }) => {
    // A parent makes a task that needs approval and gives it to the child.
    const created = await request.post('/api/tasks', {
      headers: auth(parent),
      data: { familyId, title: 'E2E approval task', requiresApproval: true },
    })
    expect(created.status(), await created.text()).toBe(201)
    const task = (await created.json()).data
    expect(task.id).toBeTruthy()

    // Only finished tasks can be archived, so a parent cancels it first.
    const cancelled = await request.patch(`/api/tasks/${task.id}`, {
      headers: auth(parent),
      data: { action: 'cancel' },
    })
    expect(cancelled.status(), await cancelled.text()).toBeLessThan(300)

    const archived = await request.patch(`/api/tasks/${task.id}`, {
      headers: auth(parent),
      data: { action: 'archive' },
    })
    expect(archived.status(), await archived.text()).toBeLessThan(300)

    const restore = await request.patch(`/api/tasks/${task.id}`, {
      headers: auth(child),
      data: { action: 'unarchive' },
    })
    expect(restore.status(), await restore.text()).toBe(403)

    const parentRestore = await request.patch(`/api/tasks/${task.id}`, {
      headers: auth(parent),
      data: { action: 'unarchive' },
    })
    expect(parentRestore.status(), await parentRestore.text()).toBeLessThan(300)
  })

  test('a child reminder waits for approval and the child cannot change it meanwhile', async ({ request }) => {
    const remindAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    const created = await request.post('/api/reminders', {
      headers: auth(child),
      data: { familyId, title: 'E2E ask-a-parent reminder', remindAt, askParent: true },
    })
    expect(created.status(), await created.text()).toBeLessThan(300)
    const body = await created.json()
    const reminder = body.data ?? body.reminder ?? body
    expect(reminder.id).toBeTruthy()

    const blocked = await request.patch(`/api/reminders/${reminder.id}`, {
      headers: auth(child),
      data: { action: 'complete' },
    })
    expect(blocked.status(), await blocked.text()).toBe(409)

    const approved = await request.patch(`/api/reminders/${reminder.id}`, {
      headers: auth(parent),
      data: { action: 'approve' },
    })
    expect(approved.status(), await approved.text()).toBeLessThan(300)

    // Editing an approved reminder sends it back for approval.
    const edited = await request.patch(`/api/reminders/${reminder.id}`, {
      headers: auth(child),
      data: { title: 'E2E edited by child' },
    })
    expect(edited.status(), await edited.text()).toBeLessThan(300)
    const again = await request.patch(`/api/reminders/${reminder.id}`, {
      headers: auth(child),
      data: { action: 'complete' },
    })
    expect(again.status(), await again.text()).toBe(409)
  })

  test('a child cannot wipe the family data with account reset', async ({ request }) => {
    const res = await request.post('/api/account/reset', {
      headers: auth(child),
      data: { confirmEmail: childEmail },
    })
    expect(res.status(), await res.text()).toBe(403)
  })

  test('changing a password signs out the old session', async ({ request, playwright, baseURL }) => {
    const before = await login(request, parentEmail)
    const newPassword = 'E2eTest-Pass2'
    const res = await request.post('/api/auth/change-password', {
      headers: auth(before),
      data: { currentPassword: PASSWORD, newPassword },
    })
    expect(res.status(), await res.text()).toBe(200)

    // /api/auth/refresh reads the cookie, so use a clean context that holds
    // only the OLD refresh token (the shared one now has the new session).
    const stale = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Cookie: `refresh_token=${before.refreshToken}` },
    })
    const refresh = await stale.post('/api/auth/refresh')
    expect(refresh.status(), await refresh.text()).toBe(401)
    await stale.dispose()

    await login(request, parentEmail, newPassword)
  })
})
