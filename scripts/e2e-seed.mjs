// Creates throwaway accounts on the dev database (whatever .env.local points
// at) and saves a Playwright storageState file per role, so the signed-in
// e2e specs stop skipping.
//
//   npm run dev            (or let Playwright start it) ... then
//   node scripts/e2e-seed.mjs            -> writes e2e/.auth/*.json + e2e/.auth/env.ps1
//   . e2e\.auth\env.ps1; npx playwright test e2e
//
// Never run this against production. It refuses any base URL that is not localhost.
import { request } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.E2E_BASE_URL || `http://localhost:${process.env.E2E_PORT || 3210}`
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error('Refusing to seed a non-local server:', BASE)
  process.exit(1)
}

const stamp = Date.now()
const PASSWORD = 'E2eTest-Pass1'
const DIR = 'e2e/.auth'
mkdirSync(DIR, { recursive: true })

async function ctx() {
  return request.newContext({ baseURL: BASE })
}
async function must(res, what) {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`)
  return res.json()
}
const bearer = (j) => ({ Authorization: `Bearer ${(j.data?.tokens ?? j.tokens).accessToken}` })

async function register(email, first) {
  const c = await ctx()
  const j = await must(
    await c.post('/api/auth/register', {
      data: { email, password: PASSWORD, firstName: first, lastName: 'E2E', ageConfirmed: true, termsAccepted: true },
    }),
    `register ${email}`,
  )
  return { c, j, email }
}
async function save(c, name) {
  await c.storageState({ path: `${DIR}/${name}.json` })
}

// Parent + family
const parent = await register(`e2e.seed.parent.${stamp}@example.com`, 'Parent')
const fam = await must(
  await parent.c.post('/api/families', { headers: bearer(parent.j), data: { name: `E2E Seed Family ${stamp}` } }),
  'create family',
)
const familyId = fam.data.id
await save(parent.c, 'parent')

// Child with a login
const childEmail = `e2e.seed.child.${stamp}@example.com`
await must(
  await parent.c.post(`/api/families/${familyId}/children`, {
    headers: bearer(parent.j),
    data: { displayName: 'Seed Kid', age: 12, consent: true, createAccount: true, email: childEmail, password: PASSWORD },
  }),
  'add child',
)
const childCtx = await ctx()
await must(await childCtx.post('/api/auth/login', { data: { email: childEmail, password: PASSWORD } }), 'child login')
await save(childCtx, 'child')

// Guest, joined through a GUEST invite code
const guest = await register(`e2e.seed.guest.${stamp}@example.com`, 'Guest')
const inv = await must(
  await parent.c.post(`/api/families/${familyId}/invite`, { headers: bearer(parent.j), data: { role: 'GUEST' } }),
  'guest invite',
)
await must(
  await guest.c.post('/api/families/join', { headers: bearer(guest.j), data: { inviteCode: inv.data.code, nickname: 'Seed Guest' } }),
  'guest join',
)
await save(guest.c, 'guest')

// Account with no family
const lone = await register(`e2e.seed.nofamily.${stamp}@example.com`, 'Solo')
await save(lone.c, 'nofamily')

const abs = (n) => `${process.cwd()}\\${DIR.replace(/\//g, '\\')}\\${n}.json`
writeFileSync(
  `${DIR}/env.ps1`,
  [
    `$env:E2E_PARENT_STATE='${abs('parent')}'`,
    `$env:E2E_CHILD_STATE='${abs('child')}'`,
    `$env:E2E_GUEST_STATE='${abs('guest')}'`,
    `$env:E2E_NOFAMILY_STATE='${abs('nofamily')}'`,
    `$env:E2E_PARENT_FAMILY_ID='${familyId}'`,
    `$env:E2E_GUEST_FAMILY_ID='${familyId}'`,
    `$env:E2E_PARENT_EMAIL='${parent.email}'`,
    `$env:E2E_PARENT_PASSWORD='${PASSWORD}'`,
    `$env:E2E_CHILD_EMAIL='${childEmail}'`,
    `$env:E2E_CHILD_PASSWORD='${PASSWORD}'`,
    `$env:E2E_GUEST_EMAIL='${guest.email}'`,
    `$env:E2E_GUEST_PASSWORD='${PASSWORD}'`,
    `$env:E2E_ALLOW_WRITES='1'`,
    '',
  ].join('\r\n'),
)
console.log('Seeded family', familyId, '-> wrote', DIR)
