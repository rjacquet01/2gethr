// Usage: BOARD_TEST_DATABASE_URL=<disposable test db> npx tsx --tsconfig tsconfig.json scripts/test-board-limits.ts
//
// End-to-end test of the family board pin limits against a disposable test database (BOARD_TEST_DATABASE_URL, see scripts/board-test-db.ts),
// inside throwaway families and users that exist only for the test. Vercel
// Blob is replaced by an in-memory fake (lib/board-flyers flyerStore), so no
// real storage is touched. Everything created here is deleted in `finally`.
//
// Covers: the 31st pin taking down the oldest unprotected pin; the 21st
// flyer taking down the oldest unprotected flyer (not a note); kept-up pins
// skipped (also for a child's note); the Keep up limit and who may set it;
// 12 parallel posts ending at exactly 30 visible with no extra or duplicate
// take-downs; restore (adults only, full board, after 30 days, after purge);
// the Taken down list; lazy event expiry, the cron marking it, and the
// "take this down after" date; purge of pins taken down 30+ days ago (files
// first, legal hold, dry run); family delete, account closure and data export
// covering taken-down pins.
import './board-test-db'
import assert from 'node:assert'

// Test-only secrets: tokens are signed and checked inside this process only.
process.env.JWT_ACCESS_SECRET = 'board-limits-test-access-secret-not-real-0123456789'
process.env.JWT_REFRESH_SECRET = 'board-limits-test-refresh-secret-not-real-0123456789'
process.env.ADMIN_JWT_SECRET ||= 'board-limits-test-placeholder-not-used'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder_never_called'

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { sql } = await import('../lib/db')
  const { generateAccessToken } = await import('../lib/auth')
  const flyers = await import('../lib/board-flyers')
  const limits = await import('../lib/board-limits')
  const { BOARD_FLYER, BOARD_LIMITS } = await import('../lib/constants')
  const { purgeBoardPosts } = await import('../lib/retention')
  const { closeUserAccount } = await import('../lib/account-closure')
  const { collectUserExport } = await import('../lib/data-export')
  const { NextRequest } = await import('next/server')
  const sharp = (await import('sharp')).default
  const boardRoute = await import('../app/api/families/[familyId]/board/route')
  const flyersRoute = await import('../app/api/families/[familyId]/board/flyers/route')
  const flyerRoute = await import('../app/api/families/[familyId]/board/[postId]/flyer/route')
  const keepUpRoute = await import('../app/api/families/[familyId]/board/[postId]/keep-up/route')
  const restoreRoute = await import('../app/api/families/[familyId]/board/[postId]/restore/route')
  const takenDownRoute = await import('../app/api/families/[familyId]/board/taken-down/route')
  const commentsRoute = await import('../app/api/families/[familyId]/board/[postId]/comments/route')
  const familyRoute = await import('../app/api/families/[familyId]/route')

  // --- in-memory Blob fake ------------------------------------------------
  const store = new Map<string, Buffer>()
  const delCalls: string[] = []
  const urlFor = (p: string) => `https://fake-store.private.blob.vercel-storage.com/${p}`
  Object.assign(flyers.flyerStore, {
    put: async (pathname: string, body: Buffer) => {
      store.set(pathname, body)
      return { pathname, url: urlFor(pathname) }
    },
    del: async (urls: string[]) => {
      for (const u of urls) {
        delCalls.push(u)
        store.delete(u.replace(/^https:\/\/[^/]+\//, ''))
      }
    },
    get: async (pathname: string) => {
      const b = store.get(pathname)
      if (!b) return null
      return {
        statusCode: 200,
        stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(b)); c.close() } }),
        blob: { etag: '"fake-etag"', contentType: 'image/jpeg' },
      }
    },
  })

  const tag = `bltest_${Date.now()}`
  const id = () => crypto.randomUUID()
  const U: Record<string, string> = { P: id(), A: id(), GD: id(), K: id(), G: id(), S: id(), D: id(), H: id(), FILL: id() }
  // Twelve more adults for the parallel-post race (each has its own rate limit).
  const RACERS = Array.from({ length: 12 }, (_, i) => `R${i}`)
  for (const r of RACERS) U[r] = id()
  const F = { MAIN: id(), FLY: id(), KID: id(), RACE: id(), EXP: id(), PURGE: id(), HELD: id(), FDEL: id(), SOLO: id() }
  const CASE = id()
  const users = Object.values(U)
  const fams = Object.values(F)
  const tokens: Record<string, string> = {}
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

  const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer()

  const req = (method: string, url: string, who: string | null, body?: FormData | object) =>
    new NextRequest(`https://test.local${url}`, {
      method,
      headers: {
        ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}),
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    })
  const p1 = (familyId: string) => ({ params: Promise.resolve({ familyId }) })
  const p2 = (familyId: string, postId: string) => ({ params: Promise.resolve({ familyId, postId }) })

  const note = (who: string, family: string, body = `note by ${who}`) =>
    boardRoute.POST(req('POST', `/api/families/${family}/board`, who, { body }), p1(family))
  const flyer = (who: string, family: string, extra: Record<string, string> = {}) => {
    const f = new FormData()
    f.append('file', new File([new Uint8Array(jpeg)], 'flyer.jpg', { type: 'image/jpeg' }))
    for (const [k, v] of Object.entries(extra)) f.append(k, v)
    return flyersRoute.POST(req('POST', `/api/families/${family}/board/flyers`, who, f), p1(family))
  }
  const board = async (who: string, family: string) => {
    const r = await boardRoute.GET(req('GET', `/api/families/${family}/board`, who), p1(family))
    return { status: r.status, data: (await r.json()).data }
  }
  const boardIds = (data: { pinned: { id: string }[]; posts: { id: string }[] }) =>
    new Set([...data.pinned, ...data.posts].map((p) => p.id))
  const keepUp = (who: string, family: string, postId: string, value: boolean) =>
    keepUpRoute.PUT(req('PUT', `/api/families/${family}/board/${postId}/keep-up`, who, { keepUp: value }), p2(family, postId))
  const restore = (who: string, family: string, postId: string) =>
    restoreRoute.POST(req('POST', `/api/families/${family}/board/${postId}/restore`, who), p2(family, postId))
  const takenDown = (who: string, family: string) =>
    takenDownRoute.GET(req('GET', `/api/families/${family}/board/taken-down`, who), p1(family))

  // Backdated rows straight into the table (the route would hit the rate limit).
  const fillNote = async (family: string, createdAt: string, extra: { keepUp?: boolean } = {}) => {
    const pid = id()
    await sql`INSERT INTO family_posts (id, family_id, user_id, body, created_at, keep_up)
              VALUES (${pid}, ${family}, ${U.FILL}, ${`filler ${pid.slice(0, 6)}`}, ${createdAt}, ${extra.keepUp === true})`
    return pid
  }
  const fillFlyer = async (
    family: string,
    createdAt: string,
    extra: { keepUp?: boolean; takenDownAt?: string; expiresAt?: string; user?: string } = {}
  ) => {
    const pid = id()
    const p = `${BOARD_FLYER.PATH_PREFIX}/${family}/${pid}-1`
    store.set(`${p}-full.jpg`, Buffer.from('x'))
    store.set(`${p}-thumb.jpg`, Buffer.from('x'))
    await sql`INSERT INTO family_posts (id, family_id, user_id, body, created_at, keep_up, taken_down_at, taken_down_reason, expires_at,
                flyer_full_path, flyer_full_url, flyer_thumb_path, flyer_thumb_url, flyer_uploaded_at)
              VALUES (${pid}, ${family}, ${extra.user ?? U.FILL}, '', ${createdAt}, ${extra.keepUp === true},
                ${extra.takenDownAt ?? null}::timestamptz, ${extra.takenDownAt ? 'roll_off' : null}, ${extra.expiresAt ?? null}::timestamptz,
                ${`${p}-full.jpg`}, ${urlFor(`${p}-full.jpg`)}, ${`${p}-thumb.jpg`}, ${urlFor(`${p}-thumb.jpg`)}, ${createdAt})`
    return pid
  }
  const visible = async (family: string) => {
    const cutoff = await limits.expiryCutoff(family)
    return limits.boardCounts(family, cutoff)
  }
  const row = async (pid: string) => (await sql`SELECT * FROM family_posts WHERE id = ${pid}`)[0]

  try {
    await limits.ensureBoardLimitColumns()

    // --- setup -----------------------------------------------------------
    for (const [key, uid] of Object.entries(U)) {
      await sql`INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, created_at, updated_at)
                VALUES (${uid}, ${`${tag}_${key}@board-limits-test.invalid`}, 'not-a-login', ${key}, 'Test', true, NOW(), NOW())`
      tokens[key] = await generateAccessToken(uid)
    }
    const fam = async (Fid: string, owner: string, members: [string, string][]) => {
      await sql`INSERT INTO families (id, name, owner_id, created_at, updated_at) VALUES (${Fid}, ${`${tag} family`}, ${owner}, NOW(), NOW())`
      for (const [uid, role] of members) {
        await sql`INSERT INTO family_members (id, family_id, user_id, role, is_active, joined_at, created_at, updated_at)
                  VALUES (${id()}, ${Fid}, ${uid}, ${role}, true, NOW(), NOW(), NOW())`
      }
    }
    const core: [string, string][] = [[U.P, 'PARENT'], [U.A, 'ADULT'], [U.GD, 'GUARDIAN'], [U.K, 'CHILD'], [U.G, 'GUEST'], [U.FILL, 'PARENT']]
    for (const Fid of [F.MAIN, F.FLY, F.KID, F.EXP, F.PURGE]) await fam(Fid, U.P, core)
    // Everyone in a held family is held, so it gets a member of its own.
    await fam(F.HELD, U.H, [[U.H, 'PARENT']])
    await fam(F.RACE, U.P, [[U.P, 'PARENT'], [U.FILL, 'PARENT'], ...RACERS.map((r) => [U[r], 'ADULT'] as [string, string])])
    await fam(F.FDEL, U.D, [[U.D, 'PARENT'], [U.FILL, 'PARENT']])
    await fam(F.SOLO, U.S, [[U.S, 'PARENT']])

    // --- 31st pin --------------------------------------------------------
    console.log('total limit')
    const main: string[] = []
    for (let i = 0; i < BOARD_LIMITS.MAX_PINS - 1; i++) main.push(await fillNote(F.MAIN, minutesAgo(600 - i)))
    let r = await keepUp('P', F.MAIN, main[0], true)
    assert.strictEqual(r.status, 200, 'parent keeps the oldest pin up')
    r = await note('A', F.MAIN, 'thirtieth')
    assert.strictEqual(r.status, 201)
    assert.deepStrictEqual((await r.json()).rolledOff, [], 'the 30th pin takes nothing down')
    r = await note('GD', F.MAIN, 'thirty-first')
    assert.strictEqual(r.status, 201)
    let j = await r.json()
    assert.strictEqual(j.rolledOff.length, 1)
    assert.strictEqual(j.rolledOff[0].id, main[1], 'the oldest UNPROTECTED pin came down')
    assert.ok(j.rolledOff[0].title.startsWith('filler'), 'rolledOff carries a title')
    assert.strictEqual((await row(main[0])).taken_down_at, null, 'kept-up oldest pin stays')
    let b = await board('P', F.MAIN)
    assert.ok(boardIds(b.data).has(j.data.id), 'the new pin is visible')
    assert.ok(!boardIds(b.data).has(main[1]), 'the taken-down pin is hidden')
    assert.strictEqual(b.data.counts.pins, BOARD_LIMITS.MAX_PINS)
    assert.strictEqual(b.data.counts.keptUp, 1)
    assert.strictEqual(b.data.counts.takenDown, 1)
    assert.ok(b.data.posts.find((p: { id: string; keepUp: boolean }) => p.id === main[0])?.keepUp, 'keepUp is in the board data')
    ok('31st pin takes down the oldest unprotected pin; the new pin is visible; header counts right')

    const kidView = await board('K', F.MAIN)
    assert.ok(!boardIds(kidView.data).has(main[1]))
    assert.strictEqual(kidView.data.counts.takenDown, null, 'kids get no taken-down count')
    assert.strictEqual(kidView.data.canManagePins, false)
    assert.strictEqual((await takenDown('K', F.MAIN)).status, 403)
    assert.strictEqual((await takenDown('G', F.MAIN)).status, 403)
    r = await commentsRoute.GET(req('GET', `/api/families/${F.MAIN}/board/${main[1]}/comments`, 'K'), p2(F.MAIN, main[1]))
    assert.strictEqual(r.status, 404, "a child can't open a taken-down pin's replies")
    r = await takenDown('A', F.MAIN)
    assert.strictEqual(r.status, 200)
    const list = (await r.json()).data.pins
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].id, main[1])
    assert.strictEqual(list[0].reason, 'roll_off')
    assert.ok(list[0].daysLeft >= BOARD_LIMITS.RESTORE_DAYS - 1)
    ok('taken-down pins are hidden from kids and guests; adults see them in Taken down')

    // --- 21st flyer --------------------------------------------------------
    console.log('flyer limit')
    const fly: string[] = []
    const notes: string[] = []
    for (let i = 0; i < 5; i++) notes.push(await fillNote(F.FLY, minutesAgo(2000 - i)))  // older than every flyer
    for (let i = 0; i < BOARD_LIMITS.MAX_FLYERS; i++) fly.push(await fillFlyer(F.FLY, minutesAgo(1000 - i), { keepUp: i === 0 }))
    r = await flyer('A', F.FLY)
    assert.strictEqual(r.status, 201)
    j = await r.json()
    assert.strictEqual(j.rolledOff.length, 1)
    assert.strictEqual(j.rolledOff[0].id, fly[1], 'the oldest unprotected FLYER came down')
    for (const n of notes) assert.strictEqual((await row(n)).taken_down_at, null, 'older notes stay up')
    assert.strictEqual((await row(fly[0])).taken_down_at, null, 'kept-up flyer stays')
    let c = await visible(F.FLY)
    assert.strictEqual(c.flyers, BOARD_LIMITS.MAX_FLYERS)
    ok('21st flyer takes down the oldest unprotected flyer, not an older note')

    r = await flyerRoute.GET(req('GET', `/api/families/${F.FLY}/board/${fly[1]}/flyer?size=thumb`, 'K'), p2(F.FLY, fly[1]))
    assert.strictEqual(r.status, 404, "child can't load a taken-down flyer image")
    r = await flyerRoute.GET(req('GET', `/api/families/${F.FLY}/board/${fly[1]}/flyer?size=thumb`, 'A'), p2(F.FLY, fly[1]))
    assert.strictEqual(r.status, 200, 'adult gets the thumbnail for the Taken down list')
    ok('taken-down flyer image: adults only')

    // --- a child's note and protected pins ---------------------------------
    console.log('protected pins')
    const kid: string[] = []
    for (let i = 0; i < BOARD_LIMITS.MAX_PINS; i++) kid.push(await fillNote(F.KID, minutesAgo(900 - i)))
    const who = ['P', 'A', 'GD', 'P', 'A']
    for (let i = 0; i < BOARD_LIMITS.MAX_KEEP_UP; i++) {
      r = await keepUp(who[i], F.KID, kid[i], true)
      assert.strictEqual(r.status, 200, `keep up #${i + 1}`)
    }
    assert.strictEqual((await r.json()).data.keptUp, BOARD_LIMITS.MAX_KEEP_UP)
    r = await keepUp('P', F.KID, kid[BOARD_LIMITS.MAX_KEEP_UP], true)
    assert.strictEqual(r.status, 400, '6th keep-up rejected')
    assert.match((await r.json()).error, new RegExp(`up to ${BOARD_LIMITS.MAX_KEEP_UP} pins`))
    assert.strictEqual((await keepUp('K', F.KID, kid[10], true)).status, 403, 'child cannot set Keep up')
    assert.strictEqual((await keepUp('G', F.KID, kid[10], true)).status, 403, 'guest cannot set Keep up')
    ok(`Keep up: ${BOARD_LIMITS.MAX_KEEP_UP} max (6th is 400 with a clear message); kids and guests can't set it`)

    r = await note('K', F.KID, 'kid note on a full board')
    assert.strictEqual(r.status, 201)
    j = await r.json()
    assert.strictEqual(j.rolledOff.length, 1)
    assert.strictEqual(j.rolledOff[0].id, kid[BOARD_LIMITS.MAX_KEEP_UP], "the child's note skipped all protected pins")
    for (let i = 0; i < BOARD_LIMITS.MAX_KEEP_UP; i++) assert.strictEqual((await row(kid[i])).taken_down_at, null)
    ok("a child's note never takes down a protected pin")

    // A burst of notes on a board with 5 protected pins: still none taken down.
    for (const w of ['A', 'GD', 'P']) assert.strictEqual((await note(w, F.KID)).status, 201)
    for (let i = 0; i < BOARD_LIMITS.MAX_KEEP_UP; i++) assert.strictEqual((await row(kid[i])).taken_down_at, null)
    c = await visible(F.KID)
    assert.strictEqual(c.pins, BOARD_LIMITS.MAX_PINS)
    r = await keepUp('A', F.KID, kid[0], false)
    assert.strictEqual(r.status, 200)
    r = await keepUp('A', F.KID, kid[29], true)
    assert.strictEqual(r.status, 200, 'a slot frees up after turning one off')
    ok('protected pins are never taken down; turning one off frees a slot')

    // --- concurrency ---------------------------------------------------------
    console.log('concurrency')
    const race: string[] = []
    const START = BOARD_LIMITS.MAX_PINS - 5
    for (let i = 0; i < START; i++) race.push(await fillNote(F.RACE, minutesAgo(700 - i)))
    const results = await Promise.all(RACERS.map((rk) => note(rk, F.RACE, `race ${rk}`)))
    assert.deepStrictEqual(results.map((x) => x.status), RACERS.map(() => 201))
    const bodies = await Promise.all(results.map((x) => x.json()))
    const offIds = bodies.flatMap((x) => x.rolledOff.map((o: { id: string }) => o.id))
    const expectedOff = START + RACERS.length - BOARD_LIMITS.MAX_PINS
    assert.strictEqual(offIds.length, expectedOff, `exactly ${expectedOff} taken down across all responses`)
    assert.strictEqual(new Set(offIds).size, offIds.length, 'no pin reported twice')
    assert.deepStrictEqual([...offIds].sort(), race.slice(0, expectedOff).sort(), 'the oldest ones, nothing newer')
    const dbOff = await sql`SELECT id FROM family_posts WHERE family_id = ${F.RACE} AND taken_down_at IS NOT NULL`
    assert.strictEqual(dbOff.length, expectedOff, 'the table agrees')
    c = await visible(F.RACE)
    assert.strictEqual(c.pins, BOARD_LIMITS.MAX_PINS, 'exactly 30 visible')
    for (const x of bodies) assert.strictEqual((await row(x.data.id)).taken_down_at, null, 'every new pin is up')
    ok(`${RACERS.length} parallel posts on a board of ${START}: exactly ${BOARD_LIMITS.MAX_PINS} visible, ${expectedOff} taken down, no duplicates`)

    // Same through the shared function directly, harder: 15 at once on a full board.
    const direct = await Promise.all(Array.from({ length: 15 }, () => {
      const pid = id()
      return limits.placePin(F.RACE, pid, sql`
        INSERT INTO family_posts (id, family_id, user_id, body) VALUES (${pid}, ${F.RACE}, ${U.FILL}, 'direct') RETURNING id`)
    }))
    const directOff = direct.flatMap((x) => x.rolledOff.map((o) => o.id))
    assert.strictEqual(directOff.length, 15)
    assert.strictEqual(new Set(directOff).size, 15)
    c = await visible(F.RACE)
    assert.strictEqual(c.pins, BOARD_LIMITS.MAX_PINS)
    ok('15 parallel placePin calls on a full board: each takes down exactly one, still 30')

    // --- restore -------------------------------------------------------------
    console.log('restore')
    assert.strictEqual((await restore('K', F.MAIN, main[1])).status, 403, 'child cannot restore')
    assert.strictEqual((await restore('G', F.MAIN, main[1])).status, 403, 'guest cannot restore')
    r = await restore('A', F.MAIN, main[1])
    assert.strictEqual(r.status, 200)
    j = await r.json()
    assert.strictEqual(j.rolledOff.length, 1, 'full board: another pin came down instead')
    assert.strictEqual(j.rolledOff[0].id, main[2], 'the oldest unprotected one (not the restored pin)')
    assert.strictEqual((await row(main[1])).taken_down_at, null)
    c = await visible(F.MAIN)
    assert.strictEqual(c.pins, BOARD_LIMITS.MAX_PINS, 'restore never exceeds 30')
    ok('restore within 30 days works; on a full board it takes down the oldest unprotected pin')

    assert.strictEqual((await restore('A', F.MAIN, main[1])).status, 409, 'already on the board')
    await sql`UPDATE family_posts SET taken_down_at = ${daysAgo(BOARD_LIMITS.RESTORE_DAYS + 1)} WHERE id = ${main[2]}`
    r = await restore('A', F.MAIN, main[2])
    assert.strictEqual(r.status, 410)
    assert.match((await r.json()).error, new RegExp(`${BOARD_LIMITS.RESTORE_DAYS} days`))
    assert.ok((await row(main[2])).taken_down_at, 'still taken down')
    r = await takenDown('A', F.MAIN)
    assert.ok(!(await r.json()).data.pins.some((p: { id: string }) => p.id === main[2]), 'gone from the list after 30 days')
    await purgeBoardPosts({ dryRun: false, familyIds: [F.MAIN] })
    assert.strictEqual((await restore('A', F.MAIN, main[2])).status, 404, 'cannot restore after purge')
    ok('restore fails after 30 days and after purge')

    // --- event expiry ----------------------------------------------------------
    console.log('event expiry')
    const tz = await limits.familyTimeZone(F.EXP)
    const today = limits.startOfDay(tz)
    const yesterday = limits.startOfDay(tz, new Date(today.getTime() - 12 * 3600_000))
    const endedYesterday = await fillFlyer(F.EXP, minutesAgo(300), { expiresAt: yesterday.toISOString() })
    const endsToday = await fillFlyer(F.EXP, minutesAgo(299), { expiresAt: today.toISOString() })
    const keptEnded = await fillFlyer(F.EXP, minutesAgo(298), { expiresAt: yesterday.toISOString(), keepUp: true })
    b = await board('K', F.EXP)
    let ids = boardIds(b.data)
    assert.ok(!ids.has(endedYesterday), 'hidden the day after its date')
    assert.ok(ids.has(endsToday), 'still up on its last day')
    assert.ok(ids.has(keptEnded), 'kept-up flyer stays past its date')
    r = await takenDown('A', F.EXP)
    let td = (await r.json()).data.pins
    assert.deepStrictEqual(td.map((p: { id: string }) => p.id), [endedYesterday])
    assert.strictEqual(td[0].reason, 'event_over')
    ok('lazy expiry hides a flyer the day after expires_at, not a kept-up one (no cron needed)')

    const marked = await limits.markExpiredPins({ familyIds: [F.EXP] })
    assert.strictEqual(marked, 1)
    const er = await row(endedYesterday)
    assert.ok(er.taken_down_at)
    assert.strictEqual(er.taken_down_reason, 'event_over')
    assert.strictEqual((await row(keptEnded)).taken_down_at, null)
    assert.strictEqual((await row(endsToday)).taken_down_at, null)
    assert.strictEqual(await limits.markExpiredPins({ familyIds: [F.EXP] }), 0, 'idempotent')
    ok("the cron marks it taken down ('event_over'), skipping kept-up and current flyers")

    r = await restore('A', F.EXP, endedYesterday)
    assert.strictEqual(r.status, 200)
    const back = await row(endedYesterday)
    assert.strictEqual(back.taken_down_at, null)
    assert.strictEqual(back.expires_at, null, 'restoring a past event clears its date')
    ok('restoring an event flyer puts it back up for good')

    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
    const ydayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(yesterday)
    r = await flyer('A', F.EXP, { expiresOn: ydayStr })
    assert.strictEqual(r.status, 400, 'a past date is refused')
    r = await flyer('A', F.EXP, { expiresOn: 'not-a-date' })
    assert.strictEqual(r.status, 400)
    r = await flyer('A', F.EXP, { expiresOn: todayStr })
    assert.strictEqual(r.status, 201)
    j = await r.json()
    assert.strictEqual(new Date(j.data.expiresAt).getTime(), today.getTime(), 'stored as the start of that day')
    ok('"Take this down after" date: stored for the family day; past or bad dates refused')

    // --- purge -------------------------------------------------------------------
    console.log('purge')
    const old = await fillFlyer(F.PURGE, minutesAgo(60), { takenDownAt: daysAgo(BOARD_LIMITS.RESTORE_DAYS + 1) })
    const recent = await fillFlyer(F.PURGE, minutesAgo(60), { takenDownAt: daysAgo(BOARD_LIMITS.RESTORE_DAYS - 1) })
    const held = await fillFlyer(F.HELD, minutesAgo(60), { user: U.H, takenDownAt: daysAgo(BOARD_LIMITS.RESTORE_DAYS + 1) })
    await sql`INSERT INTO legal_cases (id, case_number, type, status, agency, requester_name, requester_contact,
                scope_family_id, scope_from, scope_to, opened_by, opened_at)
              VALUES (${CASE}, ${`${tag}-CASE`}, 'TEST', 'OPEN', 'Limits test', 'Limits test', 'n/a',
                ${F.HELD}, ${daysAgo(365)}, NOW(), 'limits-test', NOW())`
    let d0 = delCalls.length
    const dry = await purgeBoardPosts({ dryRun: true, familyIds: [F.PURGE, F.HELD] })
    assert.strictEqual(delCalls.length, d0, 'dry run deletes no files')
    assert.strictEqual(dry.posts, 1)
    assert.ok(dry.flyerPathsListed.some((p) => p.includes(old) && p.endsWith('-full.jpg')))
    assert.ok(dry.flyerPathsListed.some((p) => p.includes(old) && p.endsWith('-thumb.jpg')))
    assert.ok(await row(old), 'dry run keeps the row')
    ok('dry run lists the taken-down flyer and deletes nothing')

    const realDel = flyers.flyerStore.del
    flyers.flyerStore.del = async () => { throw new Error('storage down') }
    const failed = await purgeBoardPosts({ dryRun: false, familyIds: [F.PURGE] })
    flyers.flyerStore.del = realDel
    assert.strictEqual(failed.keptForRetry, 1)
    assert.ok(await row(old), 'kept when its files could not be deleted')
    d0 = delCalls.length
    const real = await purgeBoardPosts({ dryRun: false, familyIds: [F.PURGE, F.HELD] })
    assert.strictEqual(real.posts, 1)
    assert.strictEqual(real.flyerFiles, 2)
    const gone = delCalls.slice(d0)
    assert.ok(gone.some((u) => u.includes(old) && u.endsWith('-full.jpg')))
    assert.ok(gone.some((u) => u.includes(old) && u.endsWith('-thumb.jpg')))
    assert.ok(!gone.some((u) => u.includes(held) || u.includes(recent)))
    assert.ok(!(await row(old)), 'old taken-down post deleted')
    assert.ok(await row(recent), 'still restorable one kept')
    assert.ok(await row(held), 'legal hold kept')
    ok('purge deletes pins taken down 30+ days ago, files first; failed files retried; hold and recent kept')

    // --- deletion paths -------------------------------------------------------------
    console.log('family delete, account closure, export')
    const fdUp = await fillFlyer(F.FDEL, minutesAgo(30), { user: U.D })
    const fdDown = await fillFlyer(F.FDEL, minutesAgo(31), { user: U.D, takenDownAt: daysAgo(2) })
    d0 = delCalls.length
    r = await familyRoute.DELETE(req('DELETE', `/api/families/${F.FDEL}`, 'D'), p1(F.FDEL))
    assert.strictEqual(r.status, 200)
    for (const pid of [fdUp, fdDown]) {
      assert.strictEqual(delCalls.slice(d0).filter((u) => u.includes(pid)).length, 2)
      assert.strictEqual((await row(pid))?.flyer_full_path ?? null, null)
    }
    ok('deleting a family deletes the files of visible and taken-down flyers')

    const soloDown = await fillFlyer(F.SOLO, minutesAgo(30), { user: U.S, takenDownAt: daysAgo(1) })
    const sExport = await collectUserExport(U.S)
    const sec = sExport.sections.find((s) => s.name === 'Family Board Posts')!
    const exported = sec.rows.find((x) => x.id === soloDown)
    assert.ok(exported, 'taken-down post is in the export')
    assert.ok(exported.taken_down_at && exported.taken_down_reason === 'roll_off' && 'keep_up' in exported && 'expires_at' in exported)
    ok('data export includes taken-down posts with their limit fields')

    const aDown = await fillFlyer(F.FLY, minutesAgo(5000), { user: U.GD, takenDownAt: daysAgo(3) })
    d0 = delCalls.length
    await closeUserAccount({ id: U.S, email: `${tag}_S@board-limits-test.invalid` })
    assert.strictEqual(delCalls.slice(d0).filter((u) => u.includes(soloDown)).length, 2)
    assert.strictEqual((await sql`SELECT count(*)::int AS n FROM family_posts WHERE family_id = ${F.SOLO}`)[0].n, 0)
    await closeUserAccount({ id: U.GD, email: `${tag}_GD@board-limits-test.invalid` })
    assert.strictEqual(delCalls.slice(d0).filter((u) => u.includes(aDown)).length, 2)
    assert.ok(!(await row(aDown)))
    ok("account closure removes taken-down posts and their files (sole family and member's own)")

    console.log(`\nAll ${passed} board limit checks passed.`)
  } finally {
    await sql`DELETE FROM legal_cases WHERE id = ${CASE}`
    await sql`DELETE FROM family_post_comments WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM family_posts WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM notifications WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM social_push_log WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM audit_logs WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM refresh_tokens WHERE user_id = ANY(${users}::text[])`.catch(() => {})
    await sql`DELETE FROM family_invites WHERE family_id = ANY(${fams}::text[])`.catch(() => {})
    await sql`DELETE FROM subscriptions WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM family_members WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM families WHERE id = ANY(${fams}::text[])`
    await sql`DELETE FROM users WHERE id = ANY(${users}::text[])`
    const left = await sql`
      SELECT (SELECT count(*)::int FROM users WHERE id = ANY(${users}::text[]))
           + (SELECT count(*)::int FROM families WHERE id = ANY(${fams}::text[]))
           + (SELECT count(*)::int FROM family_posts WHERE family_id = ANY(${fams}::text[])) AS n`
    console.log(`cleanup: ${left[0].n} test rows left`)
  }
}

main().then(() => process.exit(0), (err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
