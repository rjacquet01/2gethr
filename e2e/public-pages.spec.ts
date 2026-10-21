import { test, expect, type ConsoleMessage, type Page } from '@playwright/test'

// Smoke test: the public pages render and log no console errors. No sign-in
// and nothing written anywhere.
const PAGES: Array<{ path: string; check: (page: Page) => Promise<void> }> = [
  { path: '/', check: (page) => expect(page.locator('h1, h2').first()).toBeVisible() },
  {
    path: '/login',
    check: async (page) => {
      await expect(page.getByRole('heading', { name: 'Togethr' })).toBeVisible()
      await expect(page.locator('input[type="email"]')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    },
  },
  { path: '/privacy', check: (page) => expect(page.locator('h1, h2').first()).toHaveText(/privacy/i) },
  { path: '/terms', check: (page) => expect(page.locator('h1, h2').first()).toHaveText(/terms/i) },
]

for (const { path, check } of PAGES) {
  test(`${path} renders with no console errors`, async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))

    const res = await page.goto(path, { waitUntil: 'networkidle' })
    expect(res?.status(), `${path} HTTP status`).toBeLessThan(400)
    await check(page)
    expect(errors, `console errors on ${path}`).toEqual([])
  })
}
