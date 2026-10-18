// Usage: npx tsx --tsconfig tsconfig.json scripts/test-board-flyers.ts
//
// End-to-end test of family board flyers against the real database, inside
// throwaway families and users that exist only for the test. Vercel Blob is
// replaced by an in-memory fake (lib/board-flyers flyerStore), so no real
// storage is ever touched. Everything created here is deleted in `finally`.
//
// Covers: permission matrix (adults pin, child photo 403, guest 403,
// non-member 403, poster/parent delete), limits (20 per family incl. a
// parallel race, oversize, wrong type, fake image), image route authz and
// caching, /api/files refusing flyer paths, the 90-day purge deleting both
// blobs first (dry run deletes nothing, legal hold skipped), and account
// closure / family delete removing flyer files.
import fs from 'fs'
import path from 'path'
import assert from 'node:assert'

for (const f of ['.env.local', '.env', '.env.production.local']) {
  try {
    const m = fs.readFileSync(path.join(process.cwd(), f), 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
    if (m && !process.env.DATABASE_URL) process.env.DATABASE_URL = m[1]
  } catch {}
}
// Test-only secrets: tokens are signed and checked inside this process only.
process.env.JWT_ACCESS_SECRET = 'board-flyer-test-access-secret-not-real-0123456789'
process.env.JWT_REFRESH_SECRET = 'board-flyer-test-refresh-secret-not-real-0123456789'
process.env.ADMIN_JWT_SECRET ||= 'board-flyer-test-placeholder-not-used'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder_never_called'

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { sql } = await import('../lib/db')
  const { generateAccessToken } = await import('../lib/auth')
  const flyers = await import('../lib/board-flyers')
  const { BOARD_FLYER } = await import('../lib/constants')
  const { purgeBoardPosts } = await import('../lib/retention')
  const { closeUserAccount } = await import('../lib/account-closure')
  const { NextRequest } = await import('next/server')
  const sharp = (await import('sharp')).default
  const boardRoute = await import('../app/api/families/[familyId]/board/route')
  const flyersRoute = await import('../app/api/families/[familyId]/board/flyers/route')
  const flyerRoute = await import('../app/api/families/[familyId]/board/[postId]/flyer/route')
  const postRoute = await import('../app/api/families/[familyId]/board/[postId]/route')
  const familyRoute = await import('../app/api/families/[familyId]/route')
  const filesRoute = await import('../app/api/files/route')

  // --- in-memory Blob fake ------------------------------------------------
  const store = new Map<string, Buffer>()
  const putCalls: string[] = []
  const delCalls: string[] = []
  const urlFor = (p: string) => `https://fake-store.private.blob.vercel-storage.com/${p}`
  Object.assign(flyers.flyerStore, {
    put: async (pathname: string, body: Buffer) => {
      putCalls.push(pathname)
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

  const tag = `bftest_${Date.now()}`
  const id = () => crypto.randomUUID()
  const U = { A: id(), B: id(), C: id(), K: id(), G: id(), O: id(), S: id(), D: id(), FILL: id() }
  const F1 = id(), F2 = id(), F3 = id(), F4 = id(), CASE = id()
  const users = Object.values(U)
  const fams = [F1, F2, F3, F4]
  const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString()
  const tokens: Record<string, string> = {}

  const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 60, b: 40 } } })
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-exif' } } }).toBuffer()

  const req = (method: string, url: string, who: keyof typeof U | null, body?: FormData | object) =>
    new NextRequest(`https://test.local${url}`, {
      method,
      headers: {
        ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}),
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    })
  const form = (bytes: Buffer, type = 'image/jpeg', extra: Record<string, string> = {}) => {
    const f = new FormData()
    f.append('file', new File([new Uint8Array(bytes)], 'flyer.jpg', { type }))
    for (const [k, v] of Object.entries(extra)) f.append(k, v)
    return f
  }
  const pin = (who: keyof typeof U, family = F1, bytes = jpeg, type = 'image/jpeg', extra: Record<string, string> = {}) =>
    flyersRoute.POST(req('POST', `/api/families/${family}/board/flyers`, who, form(bytes, type, extra)), { params: Promise.resolve({ familyId: family }) })
  const image = (who: keyof typeof U, family: string, postId: string, size = 'thumb') =>
    flyerRoute.GET(req('GET', `/api/families/${family}/board/${postId}/flyer?size=${size}`, who), { params: Promise.resolve({ familyId: family, postId }) })
  const delPost = (who: keyof typeof U, postId: string) =>
    postRoute.DELETE(req('DELETE', `/api/families/${F1}/board/${postId}`, who), { params: Promise.resolve({ familyId: F1, postId }) })
  const fillerFlyer = async (family: string, createdAt: string, user = U.FILL) => {
    const pid = id()
    const p = `${BOARD_FLYER.PATH_PREFIX}/${family}/${pid}-1`
    store.set(`${p}-full.jpg`, Buffer.from('x'))
    store.set(`${p}-thumb.jpg`, Buffer.from('x'))
    await sql`INSERT INTO family_posts (id, family_id, user_id, body, created_at, flyer_full_path, flyer_full_url, flyer_thumb_path, flyer_thumb_url, flyer_uploaded_at)
              VALUES (${pid}, ${family}, ${user}, '', ${createdAt}, ${`${p}-full.jpg`}, ${urlFor(`${p}-full.jpg`)}, ${`${p}-thumb.jpg`}, ${urlFor(`${p}-thumb.jpg`)}, ${createdAt})`
    return pid
  }

  try {
    await flyers.ensureBoardFlyerColumns()

    // --- setup -----------------------------------------------------------
    for (const [key, uid] of Object.entries(U)) {
      await sql`INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, created_at, updated_at)
                VALUES (${uid}, ${`${tag}_${key}@board-flyer-test.invalid`}, 'not-a-login', ${key}, 'Test', true, NOW(), NOW())`
      tokens[key] = await generateAccessToken(uid)
    }
    const fam = async (F: string, owner: string, members: [string, string][]) => {
      await sql`INSERT INTO families (id, name, owner_id, created_at, updated_at) VALUES (${F}, ${`${tag} family`}, ${owner}, NOW(), NOW())`
      for (const [uid, role] of members) {
        await sql`INSERT INTO family_members (id, family_id, user_id, role, is_active, joined_at, created_at, updated_at)
                  VALUES (${id()}, ${F}, ${uid}, ${role}, true, NOW(), NOW(), NOW())`
      }
    }
    await fam(F1, U.A, [[U.A, 'PARENT'], [U.B, 'ADULT'], [U.C, 'GUARDIAN'], [U.K, 'CHILD'], [U.G, 'GUEST'], [U.FILL, 'PARENT']])
    await fam(F2, U.O, [[U.O, 'PARENT']])
    await fam(F3, U.S, [[U.S, 'PARENT']])
    await fam(F4, U.D, [[U.D, 'PARENT']])

    // --- permission matrix -------------------------------------------------
    console.log('permissions')
    let r = await pin('A')
    assert.strictEqual(r.status, 201, 'parent pins')
    const flyerA = (await r.json()).data
    assert.ok(flyerA.flyer?.thumbUrl.startsWith(`/api/families/${F1}/board/${flyerA.id}/flyer?size=thumb`))
    assert.ok(!JSON.stringify(flyerA).includes('blob.vercel-storage.com'), 'no raw blob URL reaches the client')
    assert.ok(putCalls.some((p) => p.startsWith(`board-flyers/${F1}/${flyerA.id}-`) && p.endsWith('-full.jpg')))
    assert.ok(putCalls.some((p) => p.startsWith(`board-flyers/${F1}/${flyerA.id}-`) && p.endsWith('-thumb.jpg')))
    const fullKey = putCalls.find((p) => p.includes(flyerA.id) && p.endsWith('-full.jpg'))!
    const meta = await sharp(store.get(fullKey)!).metadata()
    assert.strictEqual(Math.max(meta.width!, meta.height!), BOARD_FLYER.FULL_MAX_PX, 'full size is 1600px')
    assert.ok(!meta.exif, 'EXIF stripped')
    const thumbMeta = await sharp(store.get(fullKey.replace('-full.jpg', '-thumb.jpg'))!).metadata()
    assert.strictEqual(Math.max(thumbMeta.width!, thumbMeta.height!), BOARD_FLYER.THUMB_MAX_PX, 'thumb is 480px')
    ok('parent pins a flyer (1600px + 480px, EXIF stripped, no blob URL exposed)')

    r = await pin('B')
    assert.strictEqual(r.status, 201, 'adult pins')
    const flyerB = (await r.json()).data
    ok('adult pins a flyer')

    assert.strictEqual((await pin('K')).status, 403); ok('child photo upload is 403')
    assert.strictEqual((await pin('G')).status, 403); ok('guest photo upload is 403')
    assert.strictEqual((await pin('O')).status, 403); ok('non-member photo upload is 403')

    r = await boardRoute.POST(req('POST', `/api/families/${F1}/board`, 'K', { body: 'Kid note' }), { params: Promise.resolve({ familyId: F1 }) })
    assert.strictEqual(r.status, 201); ok('child can still post a text note')

    r = await boardRoute.GET(req('GET', `/api/families/${F1}/board`, 'K'), { params: Promise.resolve({ familyId: F1 }) })
    const page = (await r.json()).data
    assert.strictEqual(page.canPinFlyers, false)
    assert.ok([...page.pinned, ...page.posts].some((p: { id: string; flyer: unknown }) => p.id === flyerA.id && p.flyer))
    ok('board list shows flyers to a child (canPinFlyers false)')

    // --- image route --------------------------------------------------------
    console.log('image route')
    r = await image('C', F1, flyerA.id)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.headers.get('cache-control'), `private, max-age=${BOARD_FLYER.IMAGE_CACHE_SECONDS}`)
    assert.strictEqual(r.headers.get('content-type'), 'image/jpeg')
    assert.ok((await r.arrayBuffer()).byteLength > 100)
    ok('member gets the thumbnail, cached privately for a day')
    assert.strictEqual((await image('K', F1, flyerA.id, 'full')).status, 200); ok('child member gets the full image')
    assert.strictEqual((await image('G', F1, flyerA.id)).status, 403); ok('guest gets 403')
    assert.strictEqual((await image('O', F1, flyerA.id)).status, 403); ok('non-member gets 403')
    assert.strictEqual((await image('O', F2, flyerA.id)).status, 404); ok("another family's post id under your own family is 404")
    r = await filesRoute.GET(req('GET', `/api/files?pathname=${encodeURIComponent(fullKey)}`, 'O'))
    assert.strictEqual(r.status, 403); ok('/api/files refuses board-flyers paths')

    // --- limits --------------------------------------------------------------
    console.log('limits')
    const big = Buffer.alloc(BOARD_FLYER.MAX_UPLOAD_BYTES + 1, 1)
    r = await pin('C', F1, big); assert.strictEqual(r.status, 400); assert.match((await r.json()).error, /too large/)
    ok('oversize upload rejected')
    r = await pin('C', F1, jpeg, 'image/gif'); assert.strictEqual(r.status, 400); ok('disallowed type rejected')
    r = await pin('C', F1, Buffer.from('definitely not an image'), 'image/jpeg'); assert.strictEqual(r.status, 400); ok('fake image bytes rejected')

    // 2 live flyers now; fill to 19 with backdated rows, then race three uploads.
    for (let i = 0; i < 17; i++) await fillerFlyer(F1, ago(1 / 24))
    assert.strictEqual(await flyers.activeFlyerCount(F1), 19)
    const putsBefore = putCalls.length
    const delsBefore = delCalls.length
    const race = await Promise.all([pin('A'), pin('B'), pin('C')])
    const codes = race.map((x) => x.status).sort()
    assert.deepStrictEqual(codes, [201, 400, 400], `parallel uploads: ${codes}`)
    assert.strictEqual(await flyers.activeFlyerCount(F1), BOARD_FLYER.MAX_ACTIVE_PER_FAMILY)
    assert.strictEqual(putCalls.length - putsBefore, 6, 'all three uploads stored their two files first')
    assert.strictEqual(delCalls.length - delsBefore, 4, 'both files of each rejected upload deleted')
    ok('parallel uploads at 19 never exceed 20; rejected uploads leave no files')
    r = await pin('A'); assert.strictEqual(r.status, 400); assert.match((await r.json()).error, /20 flyers/)
    ok('21st flyer rejected with a clear message')

    // --- delete permissions ----------------------------------------------------
    console.log('delete')
    assert.strictEqual((await delPost('K', flyerB.id)).status, 403); ok("child can't delete an adult's flyer")
    let d0 = delCalls.length
    assert.strictEqual((await delPost('B', flyerB.id)).status, 200)
    assert.strictEqual(delCalls.length - d0, 2, 'poster delete removes full + thumb')
    ok('poster deletes own flyer; both files deleted')
    r = await pin('B')  // a slot is free again
    assert.strictEqual(r.status, 201)
    const flyerB2 = (await r.json()).data
    d0 = delCalls.length
    assert.strictEqual((await delPost('A', flyerB2.id)).status, 200)
    assert.strictEqual(delCalls.length - d0, 2)
    ok("parent deletes another adult's flyer; both files deleted")

    // --- retention purge ---------------------------------------------------------
    console.log('retention')
    await sql`DELETE FROM family_posts WHERE family_id = ${F1} AND user_id = ${U.FILL}`
    const oldF1 = await fillerFlyer(F1, ago(91))
    const oldF2 = await fillerFlyer(F2, ago(91), U.O)
    await sql`INSERT INTO legal_cases (id, case_number, type, status, agency, requester_name, requester_contact,
                scope_family_id, scope_from, scope_to, opened_by, opened_at)
              VALUES (${CASE}, ${`${tag}-CASE`}, 'TEST', 'OPEN', 'Flyer test', 'Flyer test', 'n/a',
                ${F2}, ${ago(365)}, NOW(), 'flyer-test', NOW())`
    d0 = delCalls.length
    const dry = await purgeBoardPosts({ dryRun: true, familyIds: [F1, F2] })
    assert.strictEqual(delCalls.length, d0, 'dry run deletes nothing')
    assert.strictEqual(dry.posts, 1)
    assert.strictEqual(dry.flyerFiles, 2)
    assert.ok(dry.flyerPathsListed.some((p) => p.includes(oldF1) && p.endsWith('-full.jpg')))
    assert.ok(dry.flyerPathsListed.some((p) => p.includes(oldF1) && p.endsWith('-thumb.jpg')))
    assert.strictEqual((await sql`SELECT 1 FROM family_posts WHERE id = ${oldF1}`).length, 1)
    ok('dry run lists both files and deletes nothing')

    const real = await purgeBoardPosts({ dryRun: false, familyIds: [F1, F2] })
    assert.strictEqual(real.posts, 1)
    assert.strictEqual(real.flyerFiles, 2)
    const purgedDels = delCalls.slice(d0)
    assert.ok(purgedDels.some((u) => u.includes(oldF1) && u.endsWith('-full.jpg')))
    assert.ok(purgedDels.some((u) => u.includes(oldF1) && u.endsWith('-thumb.jpg')))
    assert.ok(!purgedDels.some((u) => u.includes(oldF2)), 'held family files untouched')
    assert.strictEqual((await sql`SELECT 1 FROM family_posts WHERE id = ${oldF1}`).length, 0)
    assert.strictEqual((await sql`SELECT 1 FROM family_posts WHERE id = ${oldF2}`).length, 1)
    ok('purge deletes both blobs then the post; legal hold skipped')

    // A blob delete failure keeps the post for the next run.
    const failing = await fillerFlyer(F1, ago(91))
    const realDel = flyers.flyerStore.del
    flyers.flyerStore.del = async () => { throw new Error('storage down') }
    const failed = await purgeBoardPosts({ dryRun: false, familyIds: [F1] })
    flyers.flyerStore.del = realDel
    assert.strictEqual(failed.keptForRetry, 1)
    assert.strictEqual((await sql`SELECT 1 FROM family_posts WHERE id = ${failing}`).length, 1)
    await purgeBoardPosts({ dryRun: false, familyIds: [F1] })
    assert.strictEqual((await sql`SELECT 1 FROM family_posts WHERE id = ${failing}`).length, 0)
    ok('a failed blob delete keeps the post, the next run finishes it')

    // --- account closure / family delete -----------------------------------------
    console.log('account and family deletion')
    r = await pin('S', F3); assert.strictEqual(r.status, 201)
    const flyerS = (await r.json()).data
    d0 = delCalls.length
    await closeUserAccount({ id: U.S, email: `${tag}_S@board-flyer-test.invalid` })
    assert.ok(delCalls.slice(d0).filter((u) => u.includes(flyerS.id)).length === 2)
    assert.strictEqual((await sql`SELECT count(*)::int AS n FROM family_posts WHERE family_id = ${F3}`)[0].n, 0)
    ok('closing a sole-member account deletes its family flyer files and posts')

    r = await pin('C'); assert.strictEqual(r.status, 201)
    const flyerC = (await r.json()).data
    d0 = delCalls.length
    await closeUserAccount({ id: U.C, email: `${tag}_C@board-flyer-test.invalid` })
    assert.strictEqual(delCalls.slice(d0).filter((u) => u.includes(flyerC.id)).length, 2)
    assert.strictEqual((await sql`SELECT 1 FROM family_posts WHERE id = ${flyerC.id}`).length, 0)
    ok("closing a member's account deletes their flyer files and posts")

    r = await pin('D', F4); assert.strictEqual(r.status, 201)
    const flyerD = (await r.json()).data
    d0 = delCalls.length
    r = await familyRoute.DELETE(req('DELETE', `/api/families/${F4}`, 'D'), { params: Promise.resolve({ familyId: F4 }) })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(delCalls.slice(d0).filter((u) => u.includes(flyerD.id)).length, 2)
    assert.strictEqual((await sql`SELECT flyer_full_path FROM family_posts WHERE id = ${flyerD.id}`)[0].flyer_full_path, null)
    ok('deleting a family deletes its flyer files')

    console.log(`\nAll ${passed} board flyer checks passed.`)
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
