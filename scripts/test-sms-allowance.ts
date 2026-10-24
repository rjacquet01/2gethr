// Usage: npx tsx --tsconfig tsconfig.json scripts/test-sms-allowance.ts
// The Settings notice once a family's texts for the month are used up
// (lib/sms-allowance.ts). Pure logic: no database, no network.
import assert from "node:assert"
import { smsAllowanceNotice, smsResetLabel } from "../lib/sms-allowance"
import { TRIAL_SMS_QUOTA, getTierDefinition } from "../lib/subscription-tiers"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const plus = getTierDefinition("PREMIUM").limits.smsMonthlyQuota
const premium = getTierDefinition("PREMIUM_PLUS").limits.smsMonthlyQuota

assert.equal(smsAllowanceNotice(undefined), null)
assert.equal(smsAllowanceNotice({ used: 9, quota: 10, trial: true, period: "2026-10" }), null)
assert.equal(smsAllowanceNotice({ used: 0, quota: 0, trial: false, period: "2026-10" }), null, "Free has no texts to run out of")
ok("no notice before the allowance is used up, or with no allowance")

{
  const n = smsAllowanceNotice({ used: TRIAL_SMS_QUOTA, quota: TRIAL_SMS_QUOTA, trial: true, period: "2026-10" })!
  assert.equal(n.title, `All ${TRIAL_SMS_QUOTA} texts used this month`)
  assert.match(n.body, /trial's 10 text messages/)
  assert.match(n.body, /until November 1/)
  assert.match(n.body, /Push and email notifications still arrive/)
  assert.equal(n.canUpgrade, true)
}
ok("trial used up: says texts pause until the 1st, push/email still arrive, offers plans")

assert.equal(smsAllowanceNotice({ used: plus, quota: plus, trial: false, period: "2026-10" })!.canUpgrade, true)
assert.equal(smsAllowanceNotice({ used: premium, quota: premium, trial: false, period: "2026-10" })!.canUpgrade, false)
assert.ok(smsAllowanceNotice({ used: premium + 3, quota: premium, trial: false, period: "2026-10" }), "over the allowance (urgent texts) still shows")
ok("Plus offers more texts; Premium (the largest allowance) doesn't")

assert.equal(smsResetLabel("2026-12"), "January 1")
assert.equal(smsResetLabel(undefined, new Date(Date.UTC(2026, 1, 10))), "March 1")
ok("reset date rolls over the year; falls back to the current UTC month")

console.log(`\n${passed} passed`)
