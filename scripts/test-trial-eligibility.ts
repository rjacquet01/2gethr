// Usage: npx tsx --tsconfig tsconfig.json scripts/test-trial-eligibility.ts
// One free trial a year (lib/trial-eligibility.ts). Pure logic plus the
// in-memory fake through __setSqlForTests: no database, no network.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { trialEligibilityFrom, getTrialEligibility, formatTrialDate, TRIAL_COOLDOWN_DAYS } = await import("../lib/trial-eligibility")
  const { TRIAL_DAYS } = await import("../lib/subscription-tiers")
  const DAY = 24 * 60 * 60 * 1000
  const now = new Date("2026-10-25T00:00:00Z")

  assert.equal(TRIAL_COOLDOWN_DAYS, 365)
  assert.deepEqual(trialEligibilityFrom(null, now), { eligible: true, lastStartedAt: null, nextAvailableAt: null })
  ok("never had a trial: may start one")

  const started = new Date(now.getTime() - TRIAL_DAYS * DAY) // a trial that just ended
  const justEnded = trialEligibilityFrom(started, now)
  assert.equal(justEnded.eligible, false)
  assert.equal(justEnded.nextAvailableAt!.toISOString(), new Date(started.getTime() + 365 * DAY).toISOString())
  assert.equal(formatTrialDate(justEnded.nextAvailableAt!), "October 18, 2027")
  ok("trial just ended: no restart; next one a year after it began")

  assert.equal(trialEligibilityFrom(new Date(now.getTime() - 364 * DAY), now).eligible, false)
  assert.equal(trialEligibilityFrom(new Date(now.getTime() - 365 * DAY), now).eligible, true)
  assert.equal(trialEligibilityFrom(new Date(now.getTime() - 400 * DAY), now).nextAvailableAt, null)
  ok("a year after the last trial began: may start another")

  // The query covers the owner's families and this family, and reads the latest start.
  const seen: { text: string; values: unknown[] }[] = []
  let answer: unknown = null
  const fake = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    seen.push({ text: strings.join("?"), values })
    return Promise.resolve([{ last_started_at: answer }])
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  answer = new Date(Date.now() - 10 * DAY).toISOString()
  const recent = await getTrialEligibility("user-1", "family-1")
  assert.equal(recent.eligible, false)
  assert.match(seen[0].text, /new_status = 'TRIALING'/)
  assert.match(seen[0].text, /trial_ends_at IS NOT NULL/)
  assert.match(seen[0].text, /f\.owner_id = \? OR s\.family_id = \?/)
  assert.deepEqual(seen[0].values, ["user-1", "family-1", TRIAL_DAYS, "user-1", "family-1"])

  answer = null
  assert.equal((await getTrialEligibility("user-2")).eligible, true)
  assert.deepEqual(seen[1].values, ["user-2", null, TRIAL_DAYS, "user-2", null])

  answer = new Date(Date.now() - 366 * DAY).toISOString()
  assert.equal((await getTrialEligibility("user-3", "family-3")).eligible, true)
  __setSqlForTests(null)
  ok("lookup: by owner or family, parameterized; recent trial blocks, old one doesn't")

  console.log(`\n${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
