import assert from "node:assert"
import {
  StillnessTracker,
  STILL_1_AFTER_MS,
  STILL_1_INTERVAL_MS,
  STILL_2_AFTER_MS,
  STILL_2_INTERVAL_MS,
  MAX_QUIET_MS,
} from "../lib/stillness"

const HOME = { lat: 42.64288, lng: -71.11603 }
// metres north of home -> lat
const at = (northM: number) => ({ lat: HOME.lat + northM / 111320, lng: HOME.lng })
const MIN = 60_000

// 1. Sitting still with low-power (~100 m) fixes jittering +-60 m: MOVING ->
//    STILL_1 after 3 min -> STILL_2 after 10 min, never "left".
{
  const m = new StillnessTracker()
  const t0 = 0
  const states: string[] = []
  for (let i = 0; i <= 15; i++) {
    const r = m.update({ t: t0 + i * MIN, ...at(Math.sin(i) * 60), accuracy: 100, speed: 0 })
    assert.strictEqual(r.leftStill, false, `jitter must not count as leaving (minute ${i})`)
    states.push(r.state)
  }
  assert.strictEqual(states[0], "MOVING")
  assert.strictEqual(states[2], "MOVING", "2 min still is not enough")
  assert.strictEqual(states[3], "STILL_1", "3 min still -> STILL_1")
  assert.strictEqual(states[9], "STILL_1")
  assert.strictEqual(states[10], "STILL_2", "10 min still -> STILL_2")
  assert.strictEqual(m.stillIntervalMs(15 * MIN), STILL_2_INTERVAL_MS)
  assert.ok(STILL_2_INTERVAL_MS <= MAX_QUIET_MS, "never quieter than MAX_QUIET_MS")
}

// 2. Intervals per state.
{
  const m = new StillnessTracker()
  for (let i = 0; i <= 4; i++) m.update({ t: i * MIN, ...at(0), accuracy: 10 })
  assert.strictEqual(m.stillIntervalMs(2 * MIN), null, "moving -> normal pace")
  assert.strictEqual(m.stillIntervalMs(STILL_1_AFTER_MS), STILL_1_INTERVAL_MS)
  assert.strictEqual(m.stillIntervalMs(STILL_2_AFTER_MS), STILL_2_INTERVAL_MS)
}

// 3. Walking out of the radius while in STILL_2: immediate reset + report.
{
  const m = new StillnessTracker()
  for (let i = 0; i <= 12; i++) m.update({ t: i * MIN, ...at(0), accuracy: 15, speed: 0 })
  assert.strictEqual(m.state(12 * MIN), "STILL_2")
  const r = m.update({ t: 12 * MIN + 5_000, ...at(60), accuracy: 15, speed: null })
  assert.deepStrictEqual(r, { state: "MOVING", leftStill: true }, "leaving the radius ends stillness at once")
  assert.strictEqual(m.stillIntervalMs(12 * MIN + 5_000), null)
  // The next fix while moving is not another "left" event.
  const r2 = m.update({ t: 12 * MIN + 20_000, ...at(120), accuracy: 15 })
  assert.strictEqual(r2.leftStill, false)
}

// 4. Speed above 1 m/s ends stillness even inside the radius (car pulling out).
{
  const m = new StillnessTracker()
  for (let i = 0; i <= 5; i++) m.update({ t: i * MIN, ...at(0), accuracy: 20, speed: 0 })
  assert.strictEqual(m.state(5 * MIN), "STILL_1")
  const r = m.update({ t: 5 * MIN + 2_000, ...at(5), accuracy: 20, speed: 3 })
  assert.deepStrictEqual(r, { state: "MOVING", leftStill: true })
}

// 5. Slow drift (0.5-1 m/s) inside the radius: no longer still, but no forced report.
{
  const m = new StillnessTracker()
  for (let i = 0; i <= 5; i++) m.update({ t: i * MIN, ...at(0), accuracy: 20, speed: 0 })
  const r = m.update({ t: 5 * MIN + 2_000, ...at(5), accuracy: 20, speed: 0.7 })
  assert.deepStrictEqual(r, { state: "MOVING", leftStill: false })
  // It takes another full 3 minutes to back off again.
  for (let i = 1; i <= 2; i++) m.update({ t: 5 * MIN + 2_000 + i * MIN, ...at(0), accuracy: 20, speed: 0 })
  assert.strictEqual(m.state(5 * MIN + 2_000 + 2 * MIN), "MOVING")
  m.update({ t: 5 * MIN + 2_000 + 3 * MIN, ...at(0), accuracy: 20, speed: 0 })
  assert.strictEqual(m.state(5 * MIN + 2_000 + 3 * MIN), "STILL_1")
}

// 6. Fewer than 3 fixes never counts as still, however long the gap.
{
  const m = new StillnessTracker()
  m.update({ t: 0, ...at(0), accuracy: 10 })
  m.update({ t: 20 * MIN, ...at(0), accuracy: 10 })
  assert.strictEqual(m.state(20 * MIN), "MOVING")
}

// 7. Pings per hour when still for an hour (heartbeat at the state interval,
//    user interval 60 s): about 3 + 3.5 + 10 = ~17, versus 60 before.
{
  const m = new StillnessTracker()
  const userMs = 60_000
  let t = 0, sent = 0
  while (t < 60 * MIN) {
    m.update({ t, ...at(0), accuracy: 30, speed: 0 })
    sent++
    const still = m.stillIntervalMs(t)
    t += still ? Math.max(userMs, still) : userMs
  }
  console.log(`still for an hour: ${sent} pings (was 60)`)
  assert.ok(sent >= 12 && sent <= 20, `expected 12-20 pings/hour when still, got ${sent}`)
}

console.log("stillness tests passed")
