// Usage: npx tsx --tsconfig tsconfig.json scripts/test-stripe-plan-change.ts
// How a plan switch on an existing subscription is billed. Pure function, no
// Stripe calls. Upgrades on the same interval are charged immediately; every
// other change keeps "no proration".
import assert from "node:assert"
import { planChangeBilling } from "../lib/stripe-checkout"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const month = (cents: number) => ({ unit_amount: cents, recurring: { interval: "month", interval_count: 1 } })
const year = (cents: number) => ({ unit_amount: cents, recurring: { interval: "year", interval_count: 1 } })

const CHARGE_NOW = { proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete" }
const NEXT_INVOICE = { proration_behavior: "none" }

// Upgrades on the same interval: charge the difference now, and fail the
// change if the card can't be charged.
assert.deepStrictEqual(planChangeBilling(month(599), month(999)), CHARGE_NOW)
ok("Plus monthly -> Premium monthly charges the difference now")
assert.deepStrictEqual(planChangeBilling(year(5990), year(9990)), CHARGE_NOW)
ok("Plus annual -> Premium annual charges the difference now")

// Downgrades never create credits or refunds.
assert.deepStrictEqual(planChangeBilling(month(999), month(599)), NEXT_INVOICE)
ok("Premium monthly -> Plus monthly: new price from next invoice, no credit")
assert.deepStrictEqual(planChangeBilling(year(9990), year(5990)), NEXT_INVOICE)
ok("Premium annual -> Plus annual: new price from next invoice, no credit")

// Same price: nothing to charge.
assert.deepStrictEqual(planChangeBilling(month(599), month(599)), NEXT_INVOICE)
ok("same amount: no proration")

// Interval changes keep the old behavior even when the amount goes up.
assert.deepStrictEqual(planChangeBilling(month(599), year(5990)), NEXT_INVOICE)
ok("monthly -> annual: unchanged (no proration)")
assert.deepStrictEqual(planChangeBilling(year(5990), month(999)), NEXT_INVOICE)
ok("annual -> monthly: unchanged (no proration)")
assert.deepStrictEqual(planChangeBilling(month(599), year(9990)), NEXT_INVOICE)
ok("monthly Plus -> annual Premium: unchanged (no proration)")

// Missing data never turns on immediate charging.
assert.deepStrictEqual(planChangeBilling({ unit_amount: null, recurring: { interval: "month" } }, month(999)), NEXT_INVOICE)
ok("unknown current amount: no proration")
assert.deepStrictEqual(planChangeBilling(month(599), { unit_amount: null, recurring: { interval: "month" } }), NEXT_INVOICE)
ok("unknown new amount: no proration")
assert.deepStrictEqual(planChangeBilling({ unit_amount: 599 }, { unit_amount: 999 }), NEXT_INVOICE)
ok("missing recurring info: no proration")

// interval_count defaults to 1 when Stripe omits it.
assert.deepStrictEqual(
  planChangeBilling({ unit_amount: 599, recurring: { interval: "month" } }, { unit_amount: 999, recurring: { interval: "month", interval_count: 1 } }),
  CHARGE_NOW
)
ok("interval_count defaults to 1")
assert.deepStrictEqual(
  planChangeBilling({ unit_amount: 599, recurring: { interval: "month", interval_count: 1 } }, { unit_amount: 999, recurring: { interval: "month", interval_count: 3 } }),
  NEXT_INVOICE
)
ok("different interval_count: no proration")

console.log(`\nAll ${passed} plan-change checks passed.`)
