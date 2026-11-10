// Drafts Playwright specs for the main user flows, using the existing e2e specs as the style guide.
// Usage:  node scripts/credit-runs/gen-e2e.mjs [--area events]
// Output: e2e/generated/<area>.spec.ts  (drafts: review, run with `npx playwright test e2e/generated`)
import fs from "node:fs"
import path from "node:path"
import { ask, pmap, walk, usageLine, loadKey } from "./lib.mjs"

loadKey()
const args = process.argv.slice(2)
const only = args.includes("--area") ? args[args.indexOf("--area") + 1] : null
const root = process.cwd()
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")

// Each area: the pages and API routes the tests should cover (path fragments under app/).
const AREAS = {
  auth: ["app/(auth)", "app/api/auth"],
  family: ["app/(dashboard)/family", "app/api/families"],
  events: ["app/(dashboard)/calendar", "app/api/events"],
  tasks: ["app/(dashboard)/tasks", "app/api/tasks"],
  subscription: ["app/(dashboard)/subscription", "app/api/subscription", "app/api/subscriptions"],
  settings: ["app/(dashboard)/settings", "app/api/auth/profile"],
  location: ["app/(dashboard)/location", "app/api/location", "app/(dashboard)/places"],
}

const styleGuide = walk(path.join(root, "e2e"), (p) => p.endsWith(".spec.ts") && !p.includes("generated"))
  .map((p) => `=== ${path.relative(root, p)} ===\n${read(p).slice(0, 12_000)}`).join("\n\n")
const config = read(path.join(root, "playwright.config.ts"))

const SYSTEM = `You write Playwright end-to-end tests (TypeScript, @playwright/test) for "Togethr", a Next.js family coordination PWA.
Follow the style and helpers of the existing specs exactly. Tests must be deterministic and independent, use role/label/text locators,
never rely on real third parties (Stripe, SMS, email), and skip with test.skip(...) plus a comment when a flow needs credentials or data
you cannot create. Cover: the happy path, validation errors, permission differences (parent vs child vs guest), and empty states.
Return ONLY the complete contents of one .spec.ts file, no commentary.`

const areas = Object.entries(AREAS).filter(([k]) => !only || k === only)
fs.mkdirSync(path.join(root, "e2e", "generated"), { recursive: true })

await pmap(areas, 3, async ([name, frags]) => {
  const files = walk(path.join(root, "app"), (p) => /(page|route)\.tsx?$/.test(p))
    .filter((p) => frags.some((f) => p.replaceAll("\\", "/").includes(f)))
    .slice(0, 25)
  const code = files.map((p) => `=== ${path.relative(root, p).replaceAll("\\", "/")} ===\n${read(p).slice(0, 14_000)}`).join("\n\n")
  const reply = await ask({
    system: SYSTEM,
    user: `playwright.config.ts:\n${config}\n\nEXISTING SPECS (style guide):\n${styleGuide}\n\nAREA: ${name}\nSOURCE:\n${code}\n\nWrite e2e/generated/${name}.spec.ts`,
    maxTokens: 12_000,
  })
  const body = reply.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "")
  fs.writeFileSync(path.join(root, "e2e", "generated", `${name}.spec.ts`), body)
  console.log(`  wrote e2e/generated/${name}.spec.ts`)
})
console.log(`Done. ${usageLine()}`)
