import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

// Signs a page in by loading the cookies saved by scripts/e2e-seed.mjs
// (E2E_PARENT_STATE / E2E_CHILD_STATE / E2E_GUEST_STATE), instead of typing the
// password into the form again. The login API allows 10 tries per email per 15
// minutes, so a spec that signs in before every test would lock itself out.
// Returns false when no saved state exists, so the caller can use the form.
export async function signInWithState(page: Page, role: 'parent' | 'child' | 'guest' | 'nofamily'): Promise<boolean> {
  const file = process.env[`E2E_${role.toUpperCase()}_STATE`]
  if (!file) return false
  const state = JSON.parse(readFileSync(file, 'utf8')) as { cookies: Parameters<ReturnType<Page['context']>['addCookies']>[0] }
  await page.context().addCookies(state.cookies)
  // Vercel's analytics script is third-party and sometimes answers 403; the
  // browser logs that as a console error, which fails the "no console errors"
  // checks. Serve an empty script instead.
  await page.route('**/va.vercel-scripts.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  )
  // The saved access token only lasts 15 minutes; the refresh cookie lasts days.
  // Refreshing sets a fresh access cookie on this page's context.
  await page.request.post('/api/auth/refresh')
  // The app's own pages read the tokens from localStorage (hooks/use-auth.ts),
  // so copy the fresh cookie values there before any page script runs.
  const cookies = await page.context().cookies()
  const access = cookies.find((c) => c.name === 'access_token')?.value
  const refresh = cookies.find((c) => c.name === 'refresh_token')?.value
  if (access && refresh) {
    await page.addInitScript(
      ([a, r]) => {
        try {
          window.localStorage.setItem('safe_link_access_token', a)
          window.localStorage.setItem('safe_link_refresh_token', r)
        } catch {}
      },
      [access, refresh],
    )
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return true
}
