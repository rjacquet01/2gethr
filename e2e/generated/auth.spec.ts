import { test, expect, type Page, type Route } from '@playwright/test'

// Auth pages: /login, /forgot-password, /reset-password, /register and
// /onboarding, plus the auth API's own guards. Every call that would sign in,
// create an account, send an email or check a code is answered by
// page.route() in the browser. Nothing reaches the database or a mail or SMS
// provider. The few direct API requests below all fail validation or
// authentication before any database read, rate-limit write or email.
// Flows that need a real signed-in account are skipped, with the reason.

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const FAKE_TOKENS = { accessToken: 'e2e-access', refreshToken: 'e2e-refresh', expiresIn: 900 }
const FAKE_USER = { id: 'e2e-user', email: 'parent@example.com', firstName: 'Pat', lastName: 'Parent' }
const STRONG = 'Sunshine42'

// A signed-in answer for /api/auth/me, so the page reached after a mocked
// sign-in does not bounce straight back to /login.
async function stubSignedIn(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    json(route, 200, { user: { ...FAKE_USER, displayName: 'Pat Parent', primaryFamily: null, permissions: [] } })
  )
}

// Each page here has exactly one email field.
const isValid = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true }).evaluate((el) => (el as HTMLInputElement).validity.valid)

test.describe('/login', () => {
  test('shows the sign-in form and links to reset, sign-up, terms and privacy', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await expect(page.getByText('Welcome back')).toBeVisible()
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register')
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await expect(page.getByText('Forgot your password?')).toBeVisible()
  })

  test('show/hide toggles the password field', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('secret')
    await expect(password).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(password).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(password).toHaveAttribute('type', 'password')
  })

  test('empty fields are blocked by the browser and nothing is sent', async ({ page }) => {
    let calls = 0
    await page.route('**/api/auth/login', (route) => { calls++; return json(route, 500, {}) })
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    expect(await isValid(page, 'Email')).toBe(false)
    await page.getByLabel('Email', { exact: true }).fill('not-an-email')
    await page.getByLabel('Password', { exact: true }).fill('x')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    expect(await isValid(page, 'Email')).toBe(false)
    expect(calls).toBe(0)
  })

  test('wrong password shows the server error and stays on the page', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      json(route, 401, { success: false, error: 'Invalid email or password' })
    )
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByLabel('Email', { exact: true }).fill('parent@example.com')
    await page.getByLabel('Password', { exact: true }).fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByText('Invalid email or password')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled()
  })

  test('happy path: signs in and goes to /dashboard', async ({ page }) => {
    let sent: Record<string, unknown> | null = null
    await stubSignedIn(page)
    await page.route('**/api/auth/login', (route) => {
      sent = route.request().postDataJSON()
      return json(route, 200, { success: true, data: { user: FAKE_USER, tokens: FAKE_TOKENS }, message: 'Login successful' })
    })
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByLabel('Email', { exact: true }).fill('parent@example.com')
    await page.getByLabel('Password', { exact: true }).fill(STRONG)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('**/dashboard**')
    expect(sent).toMatchObject({ email: 'parent@example.com', password: STRONG })
  })

  test('honours a safe ?redirect= path', async ({ page }) => {
    await stubSignedIn(page)
    await page.route('**/api/auth/login', (route) =>
      json(route, 200, { success: true, data: { user: FAKE_USER, tokens: FAKE_TOKENS } })
    )
    await page.goto('/login?redirect=%2Fcalendar', { waitUntil: 'networkidle' })
    await page.getByLabel('Email', { exact: true }).fill('parent@example.com')
    await page.getByLabel('Password', { exact: true }).fill(STRONG)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('**/calendar**')
  })

  test('ignores an off-site ?redirect= and goes to /dashboard', async ({ page }) => {
    await stubSignedIn(page)
    await page.route('**/api/auth/login', (route) =>
      json(route, 200, { success: true, data: { user: FAKE_USER, tokens: FAKE_TOKENS } })
    )
    await page.goto('/login?redirect=%2F%2Fevil.example.com', { waitUntil: 'networkidle' })
    await page.getByLabel('Email', { exact: true }).fill('parent@example.com')
    await page.getByLabel('Password', { exact: true }).fill(STRONG)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('**/dashboard**')
    expect(new URL(page.url()).host).toMatch(/^localhost/)
  })

  test('2FA account: asks for a code, rejects a bad one, Back returns to the form', async ({ page }) => {
    let verifyBody: Record<string, unknown> | null = null
    await page.route('**/api/auth/login', (route) =>
      json(route, 200, {
        success: true,
        data: { requiresTwoFactor: true, challengeToken: 'e2e-challenge' },
        message: 'Two-factor authentication required',
      })
    )
    await page.route('**/api/auth/2fa/verify', (route) => {
      verifyBody = route.request().postDataJSON()
      return json(route, 401, { success: false, error: 'Invalid or expired code' })
    })
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByLabel('Email', { exact: true }).fill('parent@example.com')
    await page.getByLabel('Password', { exact: true }).fill(STRONG)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await expect(page.getByText('Two-factor authentication')).toBeVisible()
    const code = page.getByLabel('Code', { exact: true })
    await expect(code).toBeFocused()
    await code.fill(' 123456 ')
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByText('Invalid or expired code')).toBeVisible()
    expect(verifyBody).toMatchObject({ challengeToken: 'e2e-challenge', code: '123456' })
    await expect(page).toHaveURL(/\/login/)

    await page.getByRole('button', { name: 'Back to sign in' }).click()
    await expect(page.getByText('Welcome back')).toBeVisible()
  })

  test('2FA account: a good code finishes signing in', async ({ page }) => {
    await stubSignedIn(page)
    await page.route('**/api/auth/login', (route) =>
      json(route, 200, { success: true, data: { requiresTwoFactor: true, challengeToken: 'e2e-challenge' } })
    )
    await page.route('**/api/auth/2fa/verify', (route) =>
      json(route, 200, { success: true, data: { user: FAKE_USER, tokens: FAKE_TOKENS } })
    )
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByLabel('Email', { exact: true }).fill('parent@example.com')
    await page.getByLabel('Password', { exact: true }).fill(STRONG)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByLabel('Code', { exact: true }).fill('654321')
    await page.getByRole('button', { name: 'Verify' }).click()
    await page.waitForURL('**/dashboard**')
  })
})

test.describe('/forgot-password', () => {
  test('happy path: always shows "Check your email" with the address', async ({ page }) => {
    let sent: Record<string, unknown> | null = null
    await page.route('**/api/auth/forgot-password', (route) => {
      sent = route.request().postDataJSON()
      return json(route, 200, { success: true, message: 'If an account exists with this email, you will receive reset instructions.' })
    })
    await page.goto('/forgot-password', { waitUntil: 'networkidle' })
    await page.getByLabel('Email address').fill('someone@example.com')
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    await expect(page.getByText('Check your email', { exact: true })).toBeVisible()
    await expect(page.locator('strong', { hasText: 'someone@example.com' })).toBeVisible()
    await expect(page.getByText(/expire in 1 hour/)).toBeVisible()
    expect(sent).toEqual({ email: 'someone@example.com' })
    await page.getByRole('link', { name: 'Back to sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('the same success screen for a server error (no account enumeration)', async ({ page }) => {
    await page.route('**/api/auth/forgot-password', (route) =>
      json(route, 500, { success: false, error: 'An error occurred. Please try again.' })
    )
    await page.goto('/forgot-password', { waitUntil: 'networkidle' })
    await page.getByLabel('Email address').fill('nobody@example.com')
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    await expect(page.getByText('Check your email', { exact: true })).toBeVisible()
  })

  test('a network failure shows an error and keeps the form', async ({ page }) => {
    await page.route('**/api/auth/forgot-password', (route) => route.abort())
    await page.goto('/forgot-password', { waitUntil: 'networkidle' })
    await page.getByLabel('Email address').fill('someone@example.com')
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send reset instructions' })).toBeEnabled()
  })

  test('empty or malformed email is blocked by the browser', async ({ page }) => {
    let calls = 0
    await page.route('**/api/auth/forgot-password', (route) => { calls++; return json(route, 200, { success: true }) })
    await page.goto('/forgot-password', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    expect(await isValid(page, 'Email address')).toBe(false)
    await page.getByLabel('Email address').fill('nope')
    await page.getByRole('button', { name: 'Send reset instructions' }).click()
    expect(await isValid(page, 'Email address')).toBe(false)
    expect(calls).toBe(0)
    await expect(page.getByText('Forgot your password?')).toBeVisible()
  })
})

test.describe('/reset-password', () => {
  test('without a token: "Invalid reset link" and a way to get a new one', async ({ page }) => {
    await page.goto('/reset-password', { waitUntil: 'networkidle' })
    await expect(page.getByText('Invalid reset link')).toBeVisible()
    await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Request a new link' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
  })

  test('mismatched passwords are caught before any request', async ({ page }) => {
    let calls = 0
    await page.route('**/api/auth/reset-password', (route) => { calls++; return json(route, 200, { success: true }) })
    await page.goto('/reset-password?token=e2e-token', { waitUntil: 'networkidle' })
    await page.getByLabel('New password', { exact: true }).fill(STRONG)
    await page.getByLabel('Confirm new password', { exact: true }).fill(STRONG + 'x')
    await page.getByRole('button', { name: 'Reset password' }).click()
    await expect(page.getByText("Passwords don't match")).toBeVisible()
    expect(calls).toBe(0)
  })

  test('show password reveals both fields', async ({ page }) => {
    await page.goto('/reset-password?token=e2e-token', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text')
    await expect(page.getByLabel('Confirm new password', { exact: true })).toHaveAttribute('type', 'text')
  })

  test('an expired or used link shows the server message', async ({ page }) => {
    await page.route('**/api/auth/reset-password', (route) =>
      json(route, 400, { success: false, error: 'This reset link has expired. Please request a new one.' })
    )
    await page.goto('/reset-password?token=e2e-token', { waitUntil: 'networkidle' })
    await page.getByLabel('New password', { exact: true }).fill(STRONG)
    await page.getByLabel('Confirm new password', { exact: true }).fill(STRONG)
    await page.getByRole('button', { name: 'Reset password' }).click()
    await expect(page.getByText('This reset link has expired. Please request a new one.')).toBeVisible()
    await expect(page.getByText('Set a new password')).toBeVisible()
  })

  test('happy path: sends the token and new password, then offers sign-in', async ({ page }) => {
    let sent: Record<string, unknown> | null = null
    await page.route('**/api/auth/reset-password', (route) => {
      sent = route.request().postDataJSON()
      return json(route, 200, { success: true, message: 'Password reset successfully.' })
    })
    await page.goto('/reset-password?token=e2e-token', { waitUntil: 'networkidle' })
    await page.getByLabel('New password', { exact: true }).fill(STRONG)
    await page.getByLabel('Confirm new password', { exact: true }).fill(STRONG)
    await page.getByRole('button', { name: 'Reset password' }).click()
    await expect(page.getByText('Password reset', { exact: true })).toBeVisible()
    expect(sent).toEqual({ token: 'e2e-token', password: STRONG })
    await page.getByRole('button', { name: 'Go to sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('/register (adult, no invite)', () => {
  test('empty state: adult copy, phone field, 18+ and terms boxes, button disabled', async ({ page }) => {
    let checks = 0
    await page.route('**/api/auth/invite-check', (route) => { checks++; return json(route, 200, { success: true, data: { kind: 'OTHER' } }) })
    await page.goto('/register', { waitUntil: 'networkidle' })
    await expect(page.getByText('Create your account', { exact: true })).toBeVisible()
    await expect(page.getByText('Togethr accounts are for adults 18 and older. Children are added by a parent.')).toBeVisible()
    await expect(page.getByLabel(/Phone Number/)).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /18/ })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /I agree to the/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(checks).toBe(0)
  })

  test('password requirements and match hints update as you type', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'networkidle' })
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('abc')
    await expect(page.getByText('At least 8 characters')).toHaveClass(/text-muted-foreground/)
    await expect(page.getByText('Contains a number')).toHaveClass(/text-muted-foreground/)
    await expect(page.getByText('Contains uppercase letter')).toHaveClass(/text-muted-foreground/)
    await password.fill(STRONG)
    await expect(page.getByText('At least 8 characters')).toHaveClass(/text-foreground/)
    await expect(page.getByText('Contains a number')).toHaveClass(/text-foreground/)
    await expect(page.getByText('Contains uppercase letter')).toHaveClass(/text-foreground/)

    const confirm = page.getByLabel('Confirm Password', { exact: true })
    await confirm.fill('Sunshine4')
    await expect(page.getByText('Passwords do not match')).toBeVisible()
    await confirm.fill(STRONG)
    await expect(page.getByText('Passwords match')).toBeVisible()
  })

  test('Create account stays disabled until both 18+ and terms are ticked', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'networkidle' })
    await page.getByLabel('Email', { exact: true }).fill('new@example.com')
    await page.getByLabel('Password', { exact: true }).fill(STRONG)
    await page.getByLabel('Confirm Password', { exact: true }).fill(STRONG)
    const submit = page.getByRole('button', { name: 'Create account' })
    await expect(submit).toBeDisabled()
    await page.getByRole('checkbox', { name: /18/ }).click()
    await expect(submit).toBeDisabled()
    await page.getByRole('checkbox', { name: /I agree to the/ }).click()
    await expect(submit).toBeEnabled()
    await page.getByRole('checkbox', { name: /18/ }).click()
    await expect(submit).toBeDisabled()
  })

  test('the SMS box can only be ticked once a phone number is entered', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'networkidle' })
    const sms = page.getByRole('checkbox', { name: /Turn on text messages/ })
    await expect(sms).toBeDisabled()
    await page.getByLabel(/Phone Number/).fill('+15555550100')
    await expect(sms).toBeEnabled()
    await sms.click()
    await expect(sms).toBeChecked()
    await page.getByLabel(/Phone Number/).fill('')
    await expect(sms).toBeDisabled()
    await expect(sms).not.toBeChecked()
  })
})
