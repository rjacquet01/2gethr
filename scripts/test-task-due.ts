// Usage: npx tsx --tsconfig tsconfig.json scripts/test-task-due.ts
// The shared "overdue" rule (lib/task-due.ts) used by Home, the Today list, the
// Tasks page and the weekly digest. Pure logic: no database, no network.
import assert from "node:assert"

process.env.TZ = "America/New_York"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { isTaskOverdue, taskDueAt, isTaskActive, ACTIVE_TASK_STATUSES_DB } = await import("../lib/task-due")
  const now = new Date("2026-10-24T18:00:00-04:00") // Sat 6 pm in New York
  const task = (due: string | null, status = "PENDING") => ({ status, due_date: due })
  // How the task forms save a date-only task: 23:59:59 local, as UTC ISO.
  const dateOnlySaved = (ymd: string) => new Date(`${ymd}T23:59:59`).toISOString()

  assert.equal(isTaskOverdue(task(new Date(now.getTime() - 2 * 3600_000).toISOString()), now), true)
  ok("due 2 hours ago today: overdue")

  assert.equal(isTaskOverdue(task(new Date(now.getTime() + 2 * 3600_000).toISOString()), now), false)
  ok("due later today: not overdue")

  assert.equal(isTaskOverdue(task(dateOnlySaved("2026-10-24")), now), false)
  assert.equal(isTaskOverdue(task("2026-10-24"), now), false)
  assert.equal(isTaskOverdue(task(dateOnlySaved("2026-10-24")), new Date("2026-10-25T00:00:30-04:00")), true)
  ok("date-only due today: not overdue until the day ends")

  assert.equal(isTaskOverdue(task(dateOnlySaved("2026-10-23")), now), true)
  assert.equal(isTaskOverdue(task("2026-10-23"), now), true)
  ok("due yesterday: overdue")

  for (const s of ["COMPLETED", "APPROVED", "ON_HOLD", "CANCELLED", "completed"]) {
    assert.equal(isTaskOverdue(task("2026-10-01T09:00:00Z", s), now), false, s)
  }
  for (const s of ["PENDING", "in_progress", "PENDING_APPROVAL"]) {
    assert.equal(isTaskActive(s), true, s)
    assert.equal(isTaskOverdue(task("2026-10-01T09:00:00Z", s), now), true, s)
  }
  assert.equal(isTaskOverdue(task(null), now), false)
  assert.equal(isTaskOverdue({ status: "PENDING", dueDate: "2026-10-01T09:00:00Z" }, now), true)
  assert.deepEqual(ACTIVE_TASK_STATUSES_DB, ["PENDING", "IN_PROGRESS", "PENDING_APPROVAL"])
  ok("completed, approved, on-hold and cancelled tasks are never overdue; no date never is")

  // A family in Los Angeles: a date-only task saved there for Oct 24 ends at
  // 23:59:59 Pacific (02:59:59 Oct 25 in New York).
  process.env.TZ = "America/Los_Angeles"
  const laSaved = dateOnlySaved("2026-10-24")
  assert.equal(laSaved, "2026-10-25T06:59:59.000Z")
  assert.equal(isTaskOverdue(task(laSaved), new Date("2026-10-24T23:59:00-07:00")), false)
  assert.equal(isTaskOverdue(task(laSaved), new Date("2026-10-25T00:00:30-07:00")), true)
  assert.equal(taskDueAt("2026-10-24")!.toISOString(), "2026-10-25T06:59:59.999Z")
  ok("time zone edge: Los Angeles near midnight")

  console.log(`\n${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
