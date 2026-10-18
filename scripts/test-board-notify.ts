// Usage: npx tsx --tsconfig tsconfig.json scripts/test-board-notify.ts
//
// New-pin notifications against the real database, inside throwaway families
// and users. Push and email go through lib/social socialTransport, replaced
// here by recorders, and Vercel Blob by an in-memory fake, so nothing real
// is sent or stored. Everything created here is deleted in `finally`.
//
// Covers: recipients (everyone active except the poster and guests, children
// included, deduped); in-app always; push for every pin, honoring push_enabled
// and quiet hours; email only with email_enabled, never the note text; one
// push and one email per person per 10 minutes per board; flyers notify only
// after a successful upload; no notification for replies, restore, photo
// replace, Keep up or roll-off; never SMS.
import fs from 'fs'
import path from 'path'
import assert from 'node:assert'

for (const f of ['.env.local', '.env', '.env.production.local']) {
  try {
    const m = fs.readFileSync(path.join(process.cwd(), f), 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
    if (m && !process.env.DATABASE_URL) process.env.DATABASE_URL = m[1]
  } catch {}
}
process.env.JWT_ACCESS_SECRET = 'board-notify-test-access-secret-not-real-0123456789'
process.env.JWT_REFRESH_SECRET = 'board-notify-test-refresh-secret-not-real-0123456789'
process.env.ADMIN_JWT_SECRET ||= 'board-notify-test-placeholder-not-used'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder_never_called'

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { sql } = await import('../lib/db')
  const { generateAccessToken } = await import('../lib/auth')
  const social = await import('../lib/social')
  const flyers = await import('../lib/board-flyers')
  const { NextRequest } = await import('next/server')
  const sharp = (await import('sharp')).default
  const boardRoute = await import('../app/api/families/[familyId]/board/route')
  const flyersRoute = await import('../app/api/families/[familyId]/board/flyers/route')
  const flyerRoute = await import('../app/api/families/[familyId]/board/[postId]/flyer/route')
  const commentsRoute = await import('../app/api/families/[familyId]/board/[postId]/comments/route')
  const restoreRoute = await import('../app/api/families/[familyId]/board/[postId]/restore/route')
  const keepUpRoute = await import('../app/api/families/[familyId]/board/[postId]/keep-up/route')

  // --- recorders instead of FCM / Resend; Blob in memory ----------------------
  const pushes: { userId: string; title: string; body: string }[] = []
  const emails: { to: string; subject: string; html: string; text?: string }[] = []
  Object.assign(social.socialTransport, {
    pushReady: () => true,
    push: async (userId: string, msg: { title: string; body: string }) => { pushes.push({ userId, title: msg.title, body: msg.body }); return { sent: 1 } },
    emailReady: () => true,
    email: async (p: { to: string; subject: string; html: string; text?: string }) => { emails.push(p); return { success: true } },
  })
  const store = new Map<string, Buffer>()
  Object.assign(flyers.flyerStore, {
    put: async (pathname: string, body: Buffer) => { store.set(pathname, body); return { pathname, url: `https://fake.blob/${pathname}` } },
    del: async (urls: string[]) => { for (const u of urls) store.delete(u.replace('https://fake.blob/', '')) },
    get: async () => null,
  })

  const tag = `bntest_${Date.now()}`
  const id = () => crypto.randomUUID()
  // P posts. A adult (push+email on), K child (push+email on), N everything
  // off, Q quiet hours all day, X no settings row, G guest, I inactive,
  // S has a phone with SMS on (must never get a text).
  const U: Record<string, string> = { P: id(), A: id(), K: id(), N: id(), Q: id(), X: id(), G: id(), I: id(), S: id() }
  const F1 = id(), F2 = id()
  const users = Object.values(U)
  const fams = [F1, F2]
  const tokens: Record<string, string> = {}
  const emailOf = (k: string) => `${tag}_${k}@board-notify-test.invalid`

  const req = (method: string, url: string, who: string, body?: FormData | object) =>
    new NextRequest(`https://test.local${url}`, {
      method,
      headers: { Authorization: `Bearer ${tokens[who]}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    })
  const p1 = (familyId: string) => ({ params: Promise.resolve({ familyId }) })
  const p2 = (familyId: string, postId: string) => ({ params: Promise.resolve({ familyId, postId }) })
  const jpeg = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 10, g: 150, b: 90 } } }).jpeg().toBuffer()
  const flyerForm = (bytes: Buffer = jpeg) => {
    const f = new FormData()
    f.append('file', new File([new Uint8Array(bytes)], 'flyer.jpg', { type: 'image/jpeg' }))
    return f
  }
  const note = (who: string, family: string, body: string) =>
    boardRoute.POST(req('POST', `/api/families/${family}/board`, who, { body }), p1(family))
  const inApp = async (family: string) =>
    (await sql`SELECT user_id FROM notifications WHERE user_id = ANY(${users}::text[]) AND data->>'familyId' = ${family}`).map((r) => r.user_id as string)
  const keyOf = (uid: string) => Object.entries(U).find(([, v]) => v === uid)![0]
  const sorted = (xs: string[]) => [...xs].sort()
  const resetSlots = () => sql`DELETE FROM social_push_log WHERE user_id = ANY(${users}::text[])`

  try {
    for (const [key, uid] of Object.entries(U)) {
      await sql`INSERT INTO users (id, email, password_hash, first_name, last_name, phone, is_active, created_at, updated_at)
                VALUES (${uid}, ${emailOf(key)}, 'not-a-login', ${key === 'P' ? 'Pat <b>' : key}, 'Test', ${key === 'S' ? '+15555550100' : null}, true, NOW(), NOW())`
      tokens[key] = await generateAccessToken(uid)
    }
    await sql`ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT false`
    const settings: [string, boolean, boolean, string | null, string | null, boolean][] = [
      ['A', true, true, null, null, false],
      ['K', true, true, null, null, false],
      ['N', false, false, null, null, false],
      ['Q', true, true, '00:01', '00:00', false], // quiet all day (wraps midnight)
      ['S', true, false, null, null, true],
    ]
    for (const [k, push, email, qs, qe, sms] of settings) {
      await sql`INSERT INTO reminder_settings (id, user_id, push_enabled, email_enabled, quiet_hours_start, quiet_hours_end, sms_enabled)
                VALUES (${id()}, ${U[k]}, ${push}, ${email}, ${qs}, ${qe}, ${sms})`
    }
    const fam = async (Fid: string, members: [string, string, boolean][]) => {
      await sql`INSERT INTO families (id, name, owner_id, created_at, updated_at) VALUES (${Fid}, ${`${tag} family`}, ${U.P}, NOW(), NOW())`
      for (const [k, role, active] of members) {
        await sql`INSERT INTO family_members (id, family_id, user_id, role, is_active, joined_at, created_at, updated_at)
                  VALUES (${id()}, ${Fid}, ${U[k]}, ${role}, ${active}, NOW(), NOW(), NOW())`
      }
    }
    const members: [string, string, boolean][] = [
      ['P', 'PARENT', true], ['A', 'ADULT', true], ['K', 'CHILD', true], ['N', 'ADULT', true], ['Q', 'GUARDIAN', true],
      ['X', 'ADULT', true], ['G', 'GUEST', true], ['I', 'ADULT', false], ['S', 'ADULT', true],
    ]
    await fam(F1, members)
    await fam(F2, members)

    // --- a new note -----------------------------------------------------------
    console.log('new note')
    const secret = 'Pick up Jamie at 3:15 from the side door'
    let r = await note('P', F1, secret)
    assert.strictEqual(r.status, 201)
    const expected = ['A', 'K', 'N', 'Q', 'X', 'S']
    assert.deepStrictEqual(sorted((await inApp(F1)).map(keyOf)), sorted(expected), 'in-app: everyone active but the poster and guests')
    ok('in-app for every active member except the poster, guests and inactive members (children included)')

    assert.deepStrictEqual(sorted(pushes.map((p) => keyOf(p.userId))), sorted(['A', 'K', 'X', 'S']))
    for (const p of pushes) {
      assert.ok(!p.body.includes('Jamie') && !p.title.includes('Jamie'), 'push never shows the note text')
      assert.match(p.title, /Pat <b> Test posted on the family board/)
    }
    ok('push for every new pin; push off and quiet hours respected; lock screen shows no note text')

    // Quiet hours hold back push only; Q still gets the email.
    assert.deepStrictEqual(sorted(emails.map((e) => e.to)), sorted([emailOf('A'), emailOf('K'), emailOf('Q')]))
    for (const e of emails) {
      assert.ok(!e.html.includes('Jamie') && !(e.text || '').includes('Jamie') && !e.subject.includes('Jamie'), 'email never has the note text')
      assert.ok(e.html.includes('Pat &lt;b&gt; Test') && !e.html.includes('Pat <b>'), 'names are HTML-escaped')
      assert.ok(e.html.includes('Manage notification preferences') && e.html.includes('/settings'), 'opt-out footer like other emails')
      assert.ok(e.subject.includes('pinned a note'))
    }
    ok('email only to members with email notifications on; no note text; names escaped; opt-out footer')

    // --- coalescing -------------------------------------------------------------
    console.log('coalescing')
    const before = { push: pushes.length, email: emails.length, inApp: (await inApp(F1)).length }
    r = await note('A', F1, 'second note')
    assert.strictEqual(r.status, 201)
    assert.strictEqual(pushes.length, before.push + 1, 'only P (who has not had a board push yet) gets one')
    assert.strictEqual(pushes[pushes.length - 1].userId, U.P)
    assert.strictEqual(emails.length, before.email, 'no second email inside 10 minutes (P has no email setting)')
    assert.strictEqual((await inApp(F1)).length, before.inApp + 6, 'in-app still for everyone')
    ok('one push and one email per person per 10 minutes per board; in-app every time')

    // --- flyers ------------------------------------------------------------------
    console.log('flyers')
    pushes.length = 0; emails.length = 0
    await resetSlots()
    const f2Before = (await inApp(F2)).length
    r = await flyersRoute.POST(req('POST', `/api/families/${F2}/board/flyers`, 'P', flyerForm(Buffer.from('not an image'))), p1(F2))
    assert.strictEqual(r.status, 400)
    assert.strictEqual((await inApp(F2)).length, f2Before)
    assert.strictEqual(pushes.length + emails.length, 0)
    ok('a failed flyer upload notifies no one')
    r = await flyersRoute.POST(req('POST', `/api/families/${F2}/board/flyers`, 'P', flyerForm()), p1(F2))
    assert.strictEqual(r.status, 201)
    const flyer = (await r.json()).data
    assert.strictEqual((await inApp(F2)).length, f2Before + 6)
    assert.deepStrictEqual(sorted(pushes.map((p) => keyOf(p.userId))), sorted(['A', 'K', 'X', 'S']))
    assert.ok(pushes.every((p) => /pinned a flyer/.test(p.title)))
    assert.deepStrictEqual(sorted(emails.map((e) => e.to)), sorted([emailOf('A'), emailOf('K'), emailOf('Q')]))
    assert.ok(emails.every((e) => e.subject.includes('pinned a flyer')))
    ok('a flyer notifies after its upload succeeded (push + email + in-app)')

    // --- things that must not notify -------------------------------------------------
    console.log('no notification')
    await resetSlots()
    pushes.length = 0; emails.length = 0
    const quiet = async (label: string, run: () => Promise<Response>) => {
      const n0 = (await inApp(F2)).length
      const res = await run()
      assert.ok(res.status < 300, `${label}: ${res.status}`)
      assert.strictEqual((await inApp(F2)).length, n0, `${label}: no in-app`)
      assert.strictEqual(pushes.length + emails.length, 0, `${label}: no push/email`)
    }
    await quiet('reply', () => commentsRoute.POST(req('POST', `/api/families/${F2}/board/${flyer.id}/comments`, 'A', { body: 'Nice' }), p2(F2, flyer.id)))
    const repl = new FormData(); repl.append('file', new File([new Uint8Array(jpeg)], 'f.jpg', { type: 'image/jpeg' }))
    await quiet('replace photo', () => flyerRoute.PUT(req('PUT', `/api/families/${F2}/board/${flyer.id}/flyer`, 'P', repl), p2(F2, flyer.id)))
    await quiet('keep up', () => keepUpRoute.PUT(req('PUT', `/api/families/${F2}/board/${flyer.id}/keep-up`, 'P', { keepUp: true }), p2(F2, flyer.id)))
    await sql`UPDATE family_posts SET taken_down_at = NOW(), taken_down_reason = 'roll_off', keep_up = false WHERE id = ${flyer.id}`
    await quiet('restore', () => restoreRoute.POST(req('POST', `/api/families/${F2}/board/${flyer.id}/restore`, 'A'), p2(F2, flyer.id)))
    ok('replies, photo replace, Keep up and restore notify no one')

    // Roll-off: fill F2 to 30 with backdated rows, then one post takes one down.
    for (let i = 0; i < 29; i++) {
      await sql`INSERT INTO family_posts (id, family_id, user_id, body, created_at) VALUES (${id()}, ${F2}, ${U.X}, 'filler', NOW() - make_interval(hours => ${100 - i}))`
    }
    const n0 = (await inApp(F2)).length
    r = await note('K', F2, 'kid note on a full board')
    const rolled = (await r.json()).rolledOff
    assert.strictEqual(rolled.length, 1)
    assert.strictEqual((await inApp(F2)).length, n0 + 6, 'only the new post notified (6 recipients), nothing for the pin that came down')
    ok('roll-off itself sends nothing; only the new pin notifies')

    // --- never SMS ----------------------------------------------------------------------
    const sms = await sql`SELECT count(*)::int AS n FROM sms_usage WHERE family_id = ANY(${fams}::text[])`.catch(() => [{ n: 0 }])
    assert.strictEqual(Number(sms[0].n), 0, 'no SMS metered for these families')
    assert.ok(!('sms' in social.socialTransport), 'the board notification transport has no SMS channel')
    ok('never SMS, even for a member with a phone and SMS turned on')

    console.log(`\nAll ${passed} board notification checks passed.`)
  } finally {
    await sql`DELETE FROM family_post_comments WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM family_posts WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM notifications WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM social_push_log WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM reminder_settings WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM audit_logs WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM rate_limit_hits WHERE key LIKE ${'%' + tag + '%'}`.catch(() => {})
    await sql`DELETE FROM subscriptions WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM family_members WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM families WHERE id = ANY(${fams}::text[])`
    await sql`DELETE FROM users WHERE id = ANY(${users}::text[])`
    const left = await sql`
      SELECT (SELECT count(*)::int FROM users WHERE id = ANY(${users}::text[]))
           + (SELECT count(*)::int FROM families WHERE id = ANY(${fams}::text[]))
           + (SELECT count(*)::int FROM family_posts WHERE family_id = ANY(${fams}::text[]))
           + (SELECT count(*)::int FROM notifications WHERE user_id = ANY(${users}::text[])) AS n`
    console.log(`cleanup: ${left[0].n} test rows left`)
  }
}

main().then(() => process.exit(0), (err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
