import { defineConfig, devices } from '@playwright/test'

// Browser smoke tests (e2e/). Runs against a local `next dev` on port 3210,
// which reads .env.local (the Neon dev branch), never production. Public
// pages only: no sign-in, no database writes.
// First time on a machine: `npx playwright install chromium`.
// Next allows one `next dev` per checkout, so if one is already running,
// point the tests at it: E2E_PORT=3000 npm run test:e2e
const PORT = Number(process.env.E2E_PORT) || 3210

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
