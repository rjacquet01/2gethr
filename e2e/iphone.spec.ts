import { test, expect, type ConsoleMessage } from '@playwright/test'

// /iphone (the Home Screen steps) as an iPhone in Safari and inside
// Instagram's browser, plus the "open in Safari" strip on the home page.
// No sign-in, nothing written.
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.12.235 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 601420827)'

test.describe('iPhone in Safari', () => {
  test.use({ userAgent: SAFARI, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('/iphone highlights Add to Home Screen, no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(e.message))
    const res = await page.goto('/iphone', { waitUntil: 'networkidle' })
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'Togethr on iPhone' })).toBeVisible()
    const step2 = page.locator('section', { has: page.getByRole('heading', { name: 'Add to Home Screen' }) })
    await expect(step2.getByText('You are here')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('home page links to /iphone', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByRole('link', { name: 'On iPhone? Add Togethr to your Home Screen' })).toBeVisible()
  })
})

test.describe('iPhone inside Instagram', () => {
  test.use({ userAgent: INSTAGRAM, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('home page shows the open-in-Safari strip', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByText('For notifications, open this page in Safari.')).toBeVisible()
  })

  test('/iphone starts at Open in Safari and names Instagram', async ({ page }) => {
    await page.goto('/iphone', { waitUntil: 'networkidle' })
    const step1 = page.locator('section', { has: page.getByRole('heading', { name: 'Open in Safari' }) })
    await expect(step1.getByText('You are here')).toBeVisible()
    await expect(step1.getByText(/Instagram's built-in browser/)).toBeVisible()
    await expect(page.getByText('For notifications, open this page in Safari.')).toHaveCount(0)
  })
})
