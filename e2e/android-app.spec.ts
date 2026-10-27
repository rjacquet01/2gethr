import { test, expect } from '@playwright/test'

// Google Play: a visit from the Android app (TWA) must never receive prices,
// a plan comparison or links to pricing/checkout, not even in the first HTML
// before the browser runs any script. The server recognises the app from the
// android-app:// referrer, the togethr_android cookie or ?source=android-app
// (lib/android-app.ts). No sign-in, nothing written.

// A shown price ("$5.99", "/month"); a bare "$" + digit also appears in
// Next's embedded RSC data ("$1" references), so the raw HTML needs this.
const PRICE = /\$\d+\.\d\d|\/month|\/year/
const PURCHASE_LINK = /href="\/(pricing|subscription\/upgrade)["?]/

const APP_VISITS: Array<{ name: string; query?: string; headers?: Record<string, string> }> = [
  { name: 'android-app:// referrer', headers: { referer: 'android-app://com.togethrapp.mobile/' } },
  { name: 'app cookie', headers: { cookie: 'togethr_android=1' } },
  { name: '?source=android-app', query: '?source=android-app' },
]

for (const path of ['/', '/pricing']) {
  test(`${path}: the website HTML has prices (control)`, async ({ request }) => {
    const html = await (await request.get(path)).text()
    expect(html).toMatch(PRICE)
  })

  for (const visit of APP_VISITS) {
    test(`${path}: no prices or pricing links in the HTML for the app (${visit.name})`, async ({ request }) => {
      const res = await request.get(path + (visit.query ?? ''), { headers: visit.headers })
      expect(res.status()).toBeLessThan(400)
      const html = await res.text()
      expect(html, 'price in the HTML').not.toMatch(PRICE)
      expect(html, 'pricing or upgrade link in the HTML').not.toMatch(PURCHASE_LINK)
    })
  }

  test(`${path}: nothing priced shows in the app after scripts run either`, async ({ page }) => {
    await page.addInitScript(() => {
      try { sessionStorage.setItem('togethr-android-app', '1') } catch {}
    })
    await page.goto(path + '?source=android-app', { waitUntil: 'networkidle' })
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(PRICE)
    await expect(page.locator('a[href="/pricing"], a[href^="/subscription/upgrade"]')).toHaveCount(0)
  })
}
