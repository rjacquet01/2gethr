// Usage: BOARD_TEST_DATABASE_URL=<disposable test db> npx tsx --tsconfig tsconfig.json scripts/test-board-flyer-download.ts
//
// Download button for board flyers (GET .../board/[postId]/flyer/download),
// against a disposable test database (BOARD_TEST_DATABASE_URL, see
// scripts/board-test-db.ts), inside throwaway families and users that exist
// only for the test. Vercel Blob is replaced by an in-memory fake
// (lib/board-flyers flyerStore), so no real storage is touched. Everything
// created here is deleted in `finally`.
//
// Covers: members (parent, child) download; guest, non-member, another
// family's member and signed-out are refused; deleted, taken-down and
// expired posts are 404; the full-size EXIF-stripped copy is served (never
// the thumbnail or an original); headers (attachment, safe filename,
// private no-store, nosniff); the filename helper never uses user text.
import './board-test-db'
import assert from 'node:assert'

// Test-only secrets: tokens are signed and checked inside this process only.
process.env.JWT_ACCESS_SECRET = 'board-dl-test-access-secret-not-real-0123456789'
process.env.JWT_REFRESH_SECRET = 'board-dl-test-refresh-secret-not-real-0123456789'
process.env.ADMIN_JWT_SECRET ||= 'board-dl-test-placeholder-not-used'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder_never_called'

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { sql } = await import('../lib/db')
  const { generateAccessToken } = await import('../lib/auth')
  const flyers = await import('../lib/board-flyers')
  const { BOARD_FLYER } = await import('../lib/constants')
  const { NextRequest } = await import('next/server')
  const sharp = (await import('sharp')).default
  const flyersRoute = await import('../app/api/families/[familyId]/board/flyers/route')
  const downloadRoute = await import('../app/api/families/[familyId]/board/[postId]/flyer/download/route')

  // --- in-memory Blob fake ------------------------------------------------
  const store = new Map<string, Buffer>()
  const getCalls: string[] = []
  const urlFor = (p: string) => `https://fake-store.private.blob.vercel-storage.com/${p}`
  Object.assign(flyers.flyerStore, {
    put: async (pathname: string, body: Buffer) => {
      store.set(pathname, body)
      return { pathname, url: urlFor(pathname) }
    },
    del: async (urls: string[]) => {
      for (const u of urls) store.delete(u.replace(/^https:\/\/[^/]+\//, ''))
    },
    get: async (pathname: string) => {
      getCalls.push(pathname)
      const b = store.get(pathname)
      if (!b) return null
      return {
        statusCode: 200,
        stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(b)); c.close() } }),
        blob: { etag: '"fake-etag"', contentType: 'image/jpeg' },
      }
    },
  })

  const tag = `bdltest_${Date.now()}`
  const id = () => crypto.randomUUID()
  const U = { A: id(), K: id(), G: id(), O: id() }
  const F1 = id(), F2 = id()
  const users = Object.values(U)
  const fams = [F1, F2]
  const tokens: Record<string, string> = {}

  // A photo with EXIF (incl. GPS-like text) that must never reach a download.
  const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-exif', ImageDescription: 'GPS 40.1,-74.2' } } }).toBuffer()

  // Signed out (null) sends a token that doesn't verify: with no header at all
  // the route falls back to cookies(), which Next only allows inside a real
  // request. Both end in the same 401 branch.
  const req = (method: string, url: string, who: keyof typeof U | null, body?: FormData) =>
    new NextRequest(`https://test.local${url}`, {
      method,
      headers: { Authorization: `Bearer ${who ? tokens[who] : 'signed-out-not-a-token'}` },
      body,
    })
  const pin = async (who: keyof typeof U, caption = '') => {
    const f = new FormData()
    f.append('file', new File([new Uint8Array(jpeg)], 'IMG_0001 "evil".jpg', { type: 'image/jpeg' }))
    if (caption) f.append('body', caption)
    const r = await flyersRoute.POST(req('POST', `/api/families/${F1}/board/flyers`, who, f), { params: Promise.resolve({ familyId: F1 }) })
    assert.strictEqual(r.status, 201, 'pinned')
    return (await r.json()).data as { id: string; flyer: { downloadUrl?: string } }
  }
  const download = (who: keyof typeof U | null, postId: string, family = F1) =>
    downloadRoute.GET(req('GET', `/api/families/${family}/board/${postId}/flyer/download`, who), { params: Promise.resolve({ familyId: family, postId }) })

  try {
    await flyers.ensureBoardFlyerColumns()
    for (const [key, uid] of Object.entries(U)) {
      await sql`INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, created_at, updated_at)
                VALUES (${uid}, ${`${tag}_${key}@board-dl-test.invalid`}, 'not-a-login', ${key}, 'Test', true, NOW(), NOW())`
      tokens[key] = await generateAccessToken(uid)
    }
    const fam = async (F: string, owner: string, members: [string, string][]) => {
      await sql`INSERT INTO families (id, name, owner_id, created_at, updated_at) VALUES (${F}, ${`${tag} family`}, ${owner}, NOW(), NOW())`
      // Premium, so the plan's photo-upload cap (lib/tier-limits.ts) doesn't get in the way.
      await sql`INSERT INTO subscriptions (id, family_id, tier, status, created_at, updated_at) VALUES (${id()}, ${F}, 'PREMIUM_PLUS', 'ACTIVE', NOW(), NOW())`
      for (const [uid, role] of members) {
        await sql`INSERT INTO family_members (id, family_id, user_id, role, is_active, joined_at, created_at, updated_at)
                  VALUES (${id()}, ${F}, ${uid}, ${role}, true, NOW(), NOW(), NOW())`
      }
    }
    await fam(F1, U.A, [[U.A, 'PARENT'], [U.K, 'CHILD'], [U.G, 'GUEST']])
    await fam(F2, U.O, [[U.O, 'PARENT']])

    const post = await pin('A', 'Bake sale"; filename="../../evil.exe')
    assert.strictEqual(post.flyer.downloadUrl, `/api/families/${F1}/board/${post.id}/flyer/download`)
    ok('board posts carry a same-origin download link (no blob URL)')

    console.log('who can download')
    const today = new Date().toISOString().slice(0, 10)
    for (const who of ['A', 'K'] as const) {
      getCalls.length = 0
      const r = await download(who, post.id)
      assert.strictEqual(r.status, 200, `${who} downloads`)
      assert.strictEqual(r.headers.get('content-type'), 'image/jpeg')
      assert.strictEqual(r.headers.get('content-disposition'), `attachment; filename="togethr-flyer-${today}.jpg"`)
      assert.strictEqual(r.headers.get('cache-control'), 'private, no-store')
      assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff')
      assert.ok(!r.headers.get('etag'), 'no cache validators')
      const bytes = Buffer.from(await r.arrayBuffer())
      assert.deepStrictEqual(getCalls.length, 1)
      assert.ok(getCalls[0].startsWith(`${BOARD_FLYER.PATH_PREFIX}/${F1}/${post.id}-`) && getCalls[0].endsWith('-full.jpg'), 'the full-size copy')
      assert.ok(bytes.equals(store.get(getCalls[0])!), 'exactly the stored file')
      const meta = await sharp(bytes).metadata()
      assert.strictEqual(meta.format, 'jpeg')
      assert.ok(!meta.exif, 'EXIF stripped')
      assert.ok(!bytes.includes(Buffer.from('secret-exif')) && !bytes.includes(Buffer.from('GPS 40.1')), 'no original metadata bytes')
      assert.strictEqual(Math.max(meta.width!, meta.height!), BOARD_FLYER.FULL_MAX_PX, 'full size, not the original 2400px')
    }
    ok('parent and child download the full-size, EXIF-stripped copy with attachment + private no-store headers')

    assert.strictEqual((await download('G', post.id)).status, 403)
    assert.strictEqual((await download('O', post.id)).status, 403)
    assert.strictEqual((await download(null, post.id)).status, 401)
    assert.strictEqual((await download('O', post.id, F2)).status, 404, "another family's post through your own family")
    ok('guest 403, non-member 403, signed out 401, other family 404')

    console.log('only posts on the board')
    const gone = await pin('A')
    await sql`UPDATE family_posts SET deleted_at = NOW() WHERE id = ${gone.id}`
    assert.strictEqual((await download('A', gone.id)).status, 404)
    const down = await pin('A')
    await sql`UPDATE family_posts SET taken_down_at = NOW() WHERE id = ${down.id}`
    assert.strictEqual((await download('A', down.id)).status, 404, 'taken down: 404 even for a parent')
    const expired = await pin('A')
    await sql`UPDATE family_posts SET expires_at = NOW() - INTERVAL '3 days', keep_up = false WHERE id = ${expired.id}`
    assert.strictEqual((await download('A', expired.id)).status, 404)
    await sql`UPDATE family_posts SET keep_up = true WHERE id = ${expired.id}`
    assert.strictEqual((await download('A', expired.id)).status, 200, 'kept up past its date: still on the board')
    assert.strictEqual((await download('A', id())).status, 404, 'unknown post')
    ok('deleted, taken-down and expired posts are 404; a kept-up one downloads')

    console.log('filename')
    assert.strictEqual(flyers.flyerDownloadFilename('2026-03-04T23:30:00Z', 'image/jpeg'), 'togethr-flyer-2026-03-04.jpg')
    assert.strictEqual(flyers.flyerDownloadFilename('2026-03-04T00:00:00Z', 'image/png'), 'togethr-flyer-2026-03-04.png')
    assert.strictEqual(flyers.flyerDownloadFilename('2026-03-04T00:00:00Z', 'IMAGE/WEBP; charset=x'), 'togethr-flyer-2026-03-04.webp')
    assert.strictEqual(flyers.flyerDownloadFilename('2026-03-04T00:00:00Z', 'text/html"; x="1'), 'togethr-flyer-2026-03-04.jpg')
    assert.match(flyers.flyerDownloadFilename('not a date', 'image/jpeg'), /^togethr-flyer-\d{4}-\d{2}-\d{2}\.jpg$/)
    assert.match(flyers.flyerDownloadFilename(null, 'image/jpeg'), /^togethr-flyer-\d{4}-\d{2}-\d{2}\.jpg$/)
    ok('filename is togethr-flyer-<date>.<jpg|png|webp>; never caption, upload name or odd content types')
  } finally {
    await sql`DELETE FROM family_post_comments WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM family_posts WHERE family_id = ANY(${fams}::text[])`
    await sql`DELETE FROM notifications WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM social_push_log WHERE user_id = ANY(${users}::text[])`
    await sql`DELETE FROM audit_logs WHERE user_id = ANY(${users}::text[])`
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
  console.log(`\n${passed} passed`)
}

main().then(() => process.exit(0), (err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
