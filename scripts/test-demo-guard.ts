// Usage: npx tsx --tsconfig tsconfig.json scripts/test-demo-guard.ts
// The demo family seed (scripts/demo) must never touch production: it exits
// under NODE_ENV/VERCEL_ENV=production or when .env.local's database is the
// production one. Pure logic plus one child process run with NODE_ENV=production;
// no database, no network (the guard exits before any connection).
import assert from "node:assert"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { demoDbProblem, dbEndpoint } from "./demo/guard"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const DEV = "postgresql://u:p@ep-dev-branch-123456.us-east-2.aws.neon.tech/neondb"
const PROD = "postgresql://u:p@ep-main-branch-654321-pooler.us-east-2.aws.neon.tech/neondb"
const PROD_DIRECT = "postgresql://u:p@ep-main-branch-654321.us-east-2.aws.neon.tech/neondb"

assert.equal(dbEndpoint(PROD), dbEndpoint(PROD_DIRECT), "pooled and direct hosts are the same database")
assert.equal(demoDbProblem({ devUrl: DEV, productionUrls: [PROD] }), null)
ok("dev branch with production elsewhere: allowed")

assert.match(demoDbProblem({ devUrl: PROD_DIRECT, productionUrls: [PROD] })!, /production database/)
assert.match(demoDbProblem({ devUrl: PROD, productionUrls: [PROD_DIRECT] })!, /production database/)
ok("production host (pooled or direct): refused")

assert.match(demoDbProblem({ nodeEnv: "production", devUrl: DEV, productionUrls: [] })!, /production/)
assert.match(demoDbProblem({ vercelEnv: "production", devUrl: DEV, productionUrls: [] })!, /production/)
ok("NODE_ENV or VERCEL_ENV production: refused")

assert.match(demoDbProblem({ devUrl: null, productionUrls: [PROD] })!, /No DATABASE_URL/)
assert.match(demoDbProblem({ devUrl: "not a url", productionUrls: [] })!, /No DATABASE_URL/)
ok("no usable .env.local: refused")

// The real script, run the way someone might by mistake.
for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }] as Record<string, string>[]) {
  // Same tsx loader as this test (tsx runs from the npx cache, not node_modules).
  const run = spawnSync(process.execPath, [...process.execArgv, path.join("scripts", "demo", "seed-demo-family.ts")], {
    env: { ...process.env, ...env, DATABASE_URL: "postgresql://u:p@127.0.0.1:1/never_connected" },
    encoding: "utf8",
  })
  assert.equal(run.status, 1, `exits 1 with ${JSON.stringify(env)}`)
  assert.match(run.stderr, /Refusing to run/)
  assert.doesNotMatch(run.stdout, /Seeded/)
}
ok("seed-demo-family.ts exits before seeding under NODE_ENV/VERCEL_ENV=production")

console.log(`\n${passed} passed`)
