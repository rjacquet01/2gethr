// Usage: npx tsx --tsconfig tsconfig.json scripts/test-retention-purge.ts
//
// End-to-end test of the 90-day purge (lib/retention.ts) against the real
// database, inside two throwaway families that exist only for the test:
//   F1 - normal family: archived task/event/reminder backdated 91 days must
//        be deleted with their child rows; the same at 89 days must stay.
//   F2 - under a temporary OPEN legal case: its 91-day items must stay.
// The purge runs restricted to these two families, so no other data can be
// touched. Everything created here is deleted again in `finally`.
import fs from 'fs'
import path from 'path'
import assert from 'node:assert'

for (const f of ['.env.local', '.env', '.env.production.local']) {
  try {
    const m = fs.readFileSync(path.join(process.cwd(), f), 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
    if (m && !process.env.DATABASE_URL) process.env.DATABASE_URL = m[1]
  } catch {}
}
// lib/legal imports admin auth, which insists on a secret at import time; unused here.
process.env.ADMIN_JWT_SECRET ||= 'retention-test-placeholder-not-used'

async function main() {
  const { sql } = await import('../lib/db')
  const { purgeArchivedHistory, HISTORY_CAP_DAYS } = await import('../lib/retention')
  assert.strictEqual(HISTORY_CAP_DAYS, 90)

  const tag = `rtest_${Date.now()}`
  const id = () => crypto.randomUUID()
  const U1 = id(), U2 = id(), F1 = id(), F2 = id(), C1 = id(), C2 = id(), CASE = id()
  const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString()

  // ids per family: old (91 days) and new (89 days)
  const fam = (F: string, C: string, U: string) => ({
    F, C, U,
    tOld: id(), tNew: id(), eOld: id(), eNew: id(), rOld: id(), rNew: id(),
  })
  const a = fam(F1, C1, U1)
  const b = fam(F2, C2, U2)

  const exists = async (table: 'tasks' | 'events' | 'reminders', rowId: string) =>
    (table === 'tasks'
      ? await sql`SELECT 1 FROM tasks WHERE id = ${rowId}`
      : table === 'events'
        ? await sql`SELECT 1 FROM events WHERE id = ${rowId}`
        : await sql`SELECT 1 FROM reminders WHERE id = ${rowId}`).length === 1
  const n = async (q: Promise<Record<string, unknown>[]>) => Number((await q)[0].n)

  try {
    // --- setup -----------------------------------------------------------
    for (const [U, i] of [[U1, 1], [U2, 2]] as const) {
      await sql`INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, created_at, updated_at)
                VALUES (${U}, ${`${tag}_${i}@retention-test.invalid`}, 'not-a-login', 'Retention', 'Test', false, NOW(), NOW())`
    }
    for (const x of [a, b]) {
      await sql`INSERT INTO families (id, name, owner_id, created_at, updated_at) VALUES (${x.F}, ${`${tag} family`}, ${x.U}, NOW(), NOW())`
      await sql`INSERT INTO family_members (id, family_id, user_id, role, is_active, joined_at, created_at, updated_at)
                VALUES (${id()}, ${x.F}, ${x.U}, 'PARENT', true, NOW(), NOW(), NOW())`
      await sql`INSERT INTO calendars (id, family_id, name, is_default, created_at, updated_at) VALUES (${x.C}, ${x.F}, 'Test', true, NOW(), NOW())`
      for (const [taskId, days] of [[x.tOld, 91], [x.tNew, 89]] as const) {
        await sql`INSERT INTO tasks (id, family_id, created_by_id, title, status, created_at, updated_at)
                  VALUES (${taskId}, ${x.F}, ${x.U}, 'retention test task', 'ARCHIVED', ${ago(days + 5)}, ${ago(days)})`
        await sql`INSERT INTO task_history (task_id, user_id, action) VALUES (${taskId}, ${x.U}, 'ARCHIVED')`
        await sql`INSERT INTO task_comments (task_id, user_id, message) VALUES (${taskId}, ${x.U}, 'test comment')`
        await sql`INSERT INTO user_favorites (id, user_id, item_type, item_id) VALUES (${id()}, ${x.U}, 'task', ${taskId})`
      }
      for (const [eventId, days] of [[x.eOld, 91], [x.eNew, 89]] as const) {
        await sql`INSERT INTO events (id, calendar_id, created_by_id, title, start_time, end_time, status, created_at, updated_at)
                  VALUES (${eventId}, ${x.C}, ${x.U}, 'retention test event', ${ago(days + 0.05)}, ${ago(days)}, 'ARCHIVED', ${ago(days + 1)}, ${ago(days)})`
        await sql`INSERT INTO event_participants (id, event_id, user_id, created_at, updated_at) VALUES (${id()}, ${eventId}, ${x.U}, NOW(), NOW())`
        await sql`INSERT INTO event_comments (id, event_id, family_id, user_id, body) VALUES (${id()}, ${eventId}, ${x.F}, ${x.U}, 'test comment')`
        await sql`INSERT INTO user_favorites (id, user_id, item_type, item_id) VALUES (${id()}, ${x.U}, 'event', ${eventId})`
      }
      for (const [remId, days] of [[x.rOld, 91], [x.rNew, 89]] as const) {
        await sql`INSERT INTO reminders (id, family_id, user_id, created_by_id, title, remind_at, status, created_at, updated_at)
                  VALUES (${remId}, ${x.F}, ${x.U}, ${x.U}, 'retention test reminder', ${ago(days + 1)}, 'ARCHIVED', ${ago(days + 2)}, ${ago(days)})`
      }
    }
    // F2 is under an open legal case (scoped to the family).
    await sql`INSERT INTO legal_cases (id, case_number, type, status, agency, requester_name, requester_contact,
                scope_family_id, scope_from, scope_to, opened_by, opened_at)
              VALUES (${CASE}, ${`${tag}-CASE`}, 'TEST', 'OPEN', 'Retention test', 'Retention test', 'n/a',
                ${F2}, ${ago(365)}, NOW(), 'retention-test', NOW())`

    // --- dry run: counts only ----------------------------------------------
    const dry = await purgeArchivedHistory({ dryRun: true, familyIds: [F1, F2] })
    assert.deepStrictEqual(
      { tasks: dry.tasks, events: dry.events, reminders: dry.reminders, taskHistory: dry.taskHistory, taskComments: dry.taskComments,
        eventParticipants: dry.eventParticipants, eventComments: dry.eventComments, favorites: dry.favorites, capped: dry.capped },
      { tasks: 1, events: 1, reminders: 1, taskHistory: 1, taskComments: 1, eventParticipants: 1, eventComments: 1, favorites: 2, capped: false },
      'dry run sees exactly the one 91-day task/event/reminder in the unheld family'
    )
    assert.ok(await exists('tasks', a.tOld), 'dry run deletes nothing')

    // --- real run --------------------------------------------------------
    const res = await purgeArchivedHistory({ dryRun: false, familyIds: [F1, F2] })
    console.log('purge result:', res)

    // F1, 91 days: gone, with child rows
    assert.ok(!(await exists('tasks', a.tOld)), '91-day task deleted')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM task_history WHERE task_id = ${a.tOld}`), 0, 'its task_history deleted')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM task_comments WHERE task_id = ${a.tOld}`), 0, 'its task_comments deleted')
    assert.ok(!(await exists('events', a.eOld)), '91-day event deleted')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM event_participants WHERE event_id = ${a.eOld}`), 0, 'its participants deleted')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM event_comments WHERE event_id = ${a.eOld}`), 0, 'its comments deleted')
    assert.ok(!(await exists('reminders', a.rOld)), '91-day reminder deleted')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM user_favorites WHERE item_id = ANY(${[a.tOld, a.eOld]}::text[])`), 0, 'favorites deleted')

    // F1, 89 days: kept, with child rows
    assert.ok(await exists('tasks', a.tNew), '89-day task kept')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM task_history WHERE task_id = ${a.tNew}`), 1, '89-day task history kept')
    assert.ok(await exists('events', a.eNew), '89-day event kept')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM event_comments WHERE event_id = ${a.eNew}`), 1, '89-day event comment kept')
    assert.ok(await exists('reminders', a.rNew), '89-day reminder kept')

    // F2 (legal hold), 91 days: kept
    assert.ok(await exists('tasks', b.tOld), 'held 91-day task kept')
    assert.ok(await exists('events', b.eOld), 'held 91-day event kept')
    assert.ok(await exists('reminders', b.rOld), 'held 91-day reminder kept')
    assert.strictEqual(await n(sql`SELECT count(*)::int AS n FROM task_comments WHERE task_id = ${b.tOld}`), 1, 'held task comment kept')

    // --- safety cap: 3 eligible tasks, cap 2 -> 2 deleted, 1 left, flagged ---
    const extra = [id(), id(), id()]
    for (const t of extra) {
      await sql`INSERT INTO tasks (id, family_id, created_by_id, title, status, created_at, updated_at)
                VALUES (${t}, ${F1}, ${U1}, 'retention cap test', 'ARCHIVED', ${ago(100)}, ${ago(95)})`
    }
    const capRun = await purgeArchivedHistory({ dryRun: false, familyIds: [F1, F2], maxRowsPerTable: 2 })
    const leftOver = await n(sql`SELECT count(*)::int AS n FROM tasks WHERE id = ANY(${extra}::text[])`)
    assert.strictEqual(capRun.tasks, 2, 'no more than the cap deleted in one run')
    assert.strictEqual(capRun.capped, true, 'hitting the cap is reported')
    assert.strictEqual(leftOver, 1, 'the rest waits for the next run')
    assert.ok(await exists('tasks', a.tNew), 'cap run still keeps the 89-day task')
    // a caller can lower the cap but never raise it above MAX_ROWS_PER_TABLE
    const { MAX_ROWS_PER_TABLE } = await import('../lib/retention')
    assert.strictEqual(MAX_ROWS_PER_TABLE, 5000)

    console.log('retention purge tests passed')
  } finally {
    // --- cleanup: remove everything this test created ---------------------
    const fams = [F1, F2], users = [U1, U2], cals = [C1, C2]
    await sql`DELETE FROM legal_cases WHERE id = ${CASE}`
    await sql`DELETE FROM event_comments WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM user_favorites WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM events WHERE calendar_id = ANY(${cals}::text[])`
    await sql`DELETE FROM tasks WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM reminders WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM calendars WHERE id = ANY(${cals}::text[])`
    await sql`DELETE FROM family_members WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM families WHERE id = ANY(${fams}::text[])`
    await sql`DELETE FROM users WHERE id = ANY(${users}::text[])`
    const left = (await sql`
      SELECT
        (SELECT count(*)::int FROM users WHERE id = ANY(${users}::text[])) +
        (SELECT count(*)::int FROM families WHERE id = ANY(${fams}::text[])) +
        (SELECT count(*)::int FROM legal_cases WHERE id = ${CASE}) +
        (SELECT count(*)::int FROM tasks WHERE family_id = ANY(${fams}::text[])) +
        (SELECT count(*)::int FROM events WHERE calendar_id = ANY(${cals}::text[])) +
        (SELECT count(*)::int FROM reminders WHERE family_id = ANY(${fams}::text[])) AS n`)[0].n
    console.log(`cleanup: ${left === 0 ? 'all test data removed' : `${left} test rows LEFT BEHIND (tag ${tag})`}`)
    if (left !== 0) process.exitCode = 1
  }
}

main().catch((e) => { console.log('FAILED:', e?.message || e); process.exitCode = 1 })
