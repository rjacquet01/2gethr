// Replaces the empty placeholder tests (test.skip(true, ...)) in e2e/generated specs with real tests,
// now that scripts/e2e-seed.mjs provides signed-in accounts. Reads the page and route source for the area.
// Usage:  node scripts/credit-runs/fill-e2e.mjs [--area events|location|subscription]
// Output: overwrites e2e/generated/<area>.spec.ts (review the diff, run `npx playwright test e2e/generated/<area>.spec.ts`)
import fs from "node:fs"
import path from "node:path"
import { ask, pmap, walk, usageLine, loadKey } from "./lib.mjs"

loadKey()
const args = process.argv.slice(2)
const only = args.includes("--area") ? args[args.indexOf("--area") + 1] : null
const root = process.cwd()
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")

const AREAS = {
  events: ["app/(dashboard)/calendar", "app/api/events"],
  location: ["app/(dashboard)/location", "app/api/location"],
  subscription: ["app/(dashboard)/subscription", "app/api/subscription", "app/api/subscriptions"],
}

const helper = read(path.join(root, "e2e/helpers/auth.ts"))
const seed = read(path.join(root, "scripts/e2e-seed.mjs"))
const approvals = read(path.join(root, "e2e/signed-in/approvals.spec.ts"))
const tasksSpec = read(path.join(root, "e2e/generated/tasks.spec.ts")).slice(0, 16_000)

const SYSTEM = `You finish Playwright end-to-end specs (TypeScript, @playwright/test) for "Togethr", a Next.js family coordination PWA.
You are given a spec whose tests are EMPTY PLACEHOLDERS (bodies that only call test.skip(true, ...)) next to tests that already work.
Rewrite the whole file: keep every working test unchanged, and implement each placeholder as a real test.

Environment you can rely on (nothing else):
- Saved sessions per role via signInWithState(page, 'parent'|'child'|'guest'|'nofamily') from '../helpers/auth' (call it in beforeEach or at the start of the test). Env: E2E_PARENT_STATE etc. exist; E2E_PARENT_FAMILY_ID / E2E_GUEST_FAMILY_ID are the seeded family; E2E_ALLOW_WRITES=1. One family: a PARENT (owner), a CHILD with a login ("Seed Kid"), a GUEST ("Seed Guest"), plus a separate no-family account. Trial/free plan, no Stripe/Resend/Twilio keys set, so never rely on real third parties.
- Create test data through the app's own API using page.request (it carries the signed-in cookies): e.g. POST /api/events, /api/tasks, invites. Use unique titles (timestamp + random), and delete what you create in a try/finally. Read the route source to get exact request bodies, status codes and messages. Never invent routes or fields.
- Use role/label/text locators copied from the page source. If a flow truly cannot be reproduced with these accounts (a specific paid plan, a real payment, a second family), keep a test.skip(true, '<precise reason>') for that one test only.
- Mock third parties and plan states with page.route() where the page reads them from an API response (for example the subscription status), as the existing tests in the file do.
- Tests must be independent and deterministic. Do not weaken or delete existing assertions.
Return ONLY the complete contents of the .spec.ts file, no commentary, no code fences.`

const areas = Object.entries(AREAS).filter(([k]) => !only || k === only)

await pmap(areas, 3, async ([name, frags]) => {
  const specPath = path.join(root, "e2e", "generated", `${name}.spec.ts`)
  const spec = read(specPath)
  const files = walk(path.join(root, "app"), (p) => /(page|route)\.tsx?$/.test(p))
    .filter((p) => frags.some((f) => p.replaceAll("\\", "/").includes(f)))
    .slice(0, 28)
  const code = files
    .map((p) => `=== ${path.relative(root, p).replaceAll("\\", "/")} ===\n${read(p).slice(0, 14_000)}`)
    .join("\n\n")
  const reply = await ask({
    system: SYSTEM,
    user:
      `HELPER e2e/helpers/auth.ts:\n${helper}\n\nSEED SCRIPT (what accounts/data exist):\n${seed}\n\n` +
      `WORKING API-LEVEL EXAMPLE e2e/signed-in/approvals.spec.ts:\n${approvals}\n\n` +
      `WORKING BROWSER SPEC EXAMPLE e2e/generated/tasks.spec.ts (truncated):\n${tasksSpec}\n\n` +
      `AREA: ${name}\nSOURCE (pages and routes):\n${code}\n\nCURRENT SPEC TO FINISH (e2e/generated/${name}.spec.ts):\n${spec}`,
    maxTokens: 20_000,
  })
  const body = reply.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "")
  if (!/test\(|test\.describe/.test(body) || body.length < spec.length * 0.6) {
    fs.writeFileSync(path.join(root, "scripts/credit-runs/out", `fill-${name}.rejected.ts`), reply)
    console.log(`  ${name}: reply looked truncated or wrong, saved to out/fill-${name}.rejected.ts, spec unchanged`)
    return
  }
  fs.writeFileSync(specPath, body)
  console.log(`  rewrote e2e/generated/${name}.spec.ts`)
})
console.log(`Done. ${usageLine()}`)
