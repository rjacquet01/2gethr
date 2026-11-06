// Usage: npx tsx --tsconfig tsconfig.json scripts/test-activity-feed.ts
// Activity feed (lib/activity-feed.ts): the task wording, folding an import
// into one line, and loadActivity over a fake database: newest first, event
// edits named without an editor, private events hidden, board posts that were
// taken down hidden. No real database.
import assert from "node:assert"

process.env.TZ = "America/New_York"
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "activity-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "activity-test-refresh-secret-not-real-0123456789"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake rows
type Row = Record<string, any>

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const ME = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const FAM = "fam-1"

async function main() {
  const { taskVerb, groupActivity, loadActivity } = await import("../lib/activity-feed")
  type Item = Awaited<ReturnType<typeof loadActivity>>[number]

  // ---- wording -----------------------------------------------------------------------
  assert.equal(taskVerb("CREATED", null), "added the task")
  assert.equal(taskVerb("COMPLETED", {}), "completed the task")
  assert.equal(taskVerb("APPROVED", { assignment: "accepted" }), "accepted the task")
  assert.equal(taskVerb("APPROVED", { approvedBy: "x" }), "approved the task")
  assert.equal(taskVerb("REJECTED", { assignment: "declined" }), "declined the task")
  assert.equal(taskVerb("REJECTED", { reason: "no" }), "sent back the task")
  assert.equal(taskVerb("ARCHIVED", {}), null, "system and housekeeping actions are not shown")
  assert.equal(taskVerb("STARTED", {}), null)
  ok("task wording: accepted vs approved, declined vs sent back; housekeeping actions skipped")

  // ---- folding an import into one line -------------------------------------------------
  const mk = (i: number, minsAgo: number, actor: string, groupKey?: string): Item => ({
    id: `i${i}`, kind: "event", at: new Date(Date.UTC(2026, 10, 5, 12, 0) - minsAgo * 60000).toISOString(),
    actor, verb: "added the event", subject: `E${i}`, tail: "", href: `/calendar/event/${i}`, groupKey,
  })
  {
    const imported = [0, 1, 2, 3, 4].map((i) => mk(i, i * 0.1, "Mom", "event"))
    const out = groupActivity(imported)
    assert.equal(out.length, 1)
    assert.equal(out[0].verb, "added 5 events")
    assert.equal(out[0].subject, "")
    assert.equal(out[0].actor, "Mom")
    const two = groupActivity([mk(0, 0, "Mom", "event"), mk(1, 1, "Mom", "event")])
    assert.equal(two.length, 2, "two additions stay separate")
    const mixed = groupActivity([mk(0, 0, "Mom", "event"), mk(1, 1, "Dad", "event"), mk(2, 2, "Mom", "event")])
    assert.equal(mixed.length, 3, "different people are never folded together")
    const far = groupActivity([mk(0, 0, "Mom", "event"), mk(1, 10, "Mom", "event"), mk(2, 20, "Mom", "event")])
    assert.equal(far.length, 3, "additions hours apart are not an import")
  }
  ok("an import (3+ additions by one person within minutes) is one line; others stay separate")

  // ---- loadActivity over a fake database ------------------------------------------------
  const { __setSqlForTests } = await import("../lib/db")
  const now = Date.now()
  const ago = (mins: number) => new Date(now - mins * 60000).toISOString()
  const queries: string[] = []
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?")
    queries.push(text)
    if (text.includes("FROM task_history")) {
      return [
        { id: "h1", action: "COMPLETED", created_at: ago(5), new_value: {}, task_id: "t1", title: "Take out trash", actor: "Jimmy" },
        { id: "h2", action: "CREATED", created_at: ago(300), new_value: {}, task_id: "t2", title: "Dishes", actor: "Mom" },
      ]
    }
    if (text.includes("FROM events e")) {
      return [
        { id: "e1", title: "Soccer", status: "APPROVED", visibility: "FAMILY", created_by_id: OTHER, created_at: ago(2000), updated_at: ago(60), actor: "Dad" },
        { id: "e2", title: "Surprise party", status: "APPROVED", visibility: "PRIVATE", created_by_id: OTHER, created_at: ago(30), updated_at: ago(30), actor: "Dad" },
        { id: "e3", title: "Piano", status: "PENDING", visibility: "FAMILY", created_by_id: OTHER, created_at: ago(10), updated_at: ago(10), actor: "Mia" },
      ]
    }
    if (text.includes("FROM family_posts")) {
      return [
        { id: "p1", body: "Spring concert flyer", created_at: ago(20), taken_down_at: null, keep_up: true, expires_at: null, has_flyer: true, actor: "Mom" },
        { id: "p2", body: "Old flyer", created_at: ago(40), taken_down_at: ago(10), keep_up: false, expires_at: null, has_flyer: true, actor: "Mom" },
      ]
    }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const items = await loadActivity(FAM, ME, { days: 30, limit: 40 })
  const text = (i: Item) => `${i.actor ? i.actor + " " : ""}${i.verb ? i.verb + " " : ""}${i.subject}${i.tail}`.trim()
  const lines = items.map(text)
  assert.deepStrictEqual(lines, [
    "Jimmy completed the task Take out trash",
    "Mia asked to add the event Piano",
    "Mom posted a flyer on the Board: Spring concert flyer",
    "Soccer was changed",
    "Mom added the task Dishes",
    "Dad added the event Soccer",
  ])
  ok("newest first: task, pending request, board flyer, an edited event (no editor named), older items")

  assert.ok(!lines.some((l) => l.includes("Surprise party")), "another person's PRIVATE event is not shown")
  assert.ok(!lines.some((l) => l.includes("Old flyer")), "a taken-down board post is not shown")
  ok("private events of others and taken-down posts stay hidden")

  assert.ok(queries.every((q) => !/\b(INSERT|UPDATE|DELETE)\b/.test(q.replace(/--.*$/gm, "")) || /CREATE TABLE|ALTER TABLE|CREATE INDEX/i.test(q)), "no data written")
  ok("read only: no inserts, updates or deletes")

  __setSqlForTests(null)
  console.log(`\n${passed} passed`)
}

main().catch((e) => { console.error(e); process.exit(1) })
