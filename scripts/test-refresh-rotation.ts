// Usage: npx tsx scripts/test-refresh-rotation.ts
// Tests rotateRefreshToken() (lib/auth.ts) against a session-only TEMP table
// that shadows refresh_tokens on a direct connection, so the real table is
// never touched. Each
// statement autocommits (no wrapping transaction) so NOW() differs between
// them as it does in production. Dev branch only (scripts/dev-db.ts).
import './dev-db'
import assert from 'node:assert'

// Tokens signed here are never checked by the app; test-only secrets.
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-not-used-in-production'
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-not-used-in-production'

async function main() {
  const { Pool, neonConfig } = await import('@neondatabase/serverless')
  neonConfig.webSocketConstructor = WebSocket
  const { rotateRefreshToken, generateRefreshToken, REFRESH_REPLACEMENT_WINDOW_SEC } = await import('../lib/auth')

  // Direct (non-pooler) host: through the transaction pooler a TEMP table can
  // outlive this connection on a shared server session where the app's own
  // queries would see it. A direct connection's temp table dies with it.
  const direct = process.env.DATABASE_URL!.replace('-pooler.', '.')
  const pool = new Pool({ connectionString: direct, max: 1 })
  const client = await pool.connect()
  const db = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await client.query(text, values)).rows as Record<string, unknown>[]
  }

  try {
    await client.query(`CREATE TEMP TABLE refresh_tokens (LIKE public.refresh_tokens INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`)
    const isTemp = (await client.query(
      `SELECT relnamespace = pg_my_temp_schema() AS t FROM pg_class WHERE oid = to_regclass('refresh_tokens')`
    )).rows[0]?.t
    if (isTemp !== true) throw new Error('refresh_tokens does not resolve to the temp table; aborting')

    const USER = 'test-user-rotation'
    let n = 0
    const seed = async (opts: { revokedAgoSec?: number; expired?: boolean; user?: string } = {}) => {
      const token = `old-token-${++n}-${Date.now()}`
      await db`
        INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at, revoked_at, user_agent, ip_address)
        VALUES (${crypto.randomUUID()}, ${opts.user ?? USER}, ${token},
          NOW() + ${opts.expired ? '-1 day' : '7 days'}::interval, NOW() - interval '1 hour',
          ${opts.revokedAgoSec == null ? null : new Date(Date.now() - opts.revokedAgoSec * 1000).toISOString()}::timestamptz,
          'Seed UA', '10.0.0.1')`
      return token
    }
    const active = async () => (await db`SELECT token, user_agent FROM refresh_tokens WHERE user_id = ${USER} AND revoked_at IS NULL`)

    // 1. Same user, same second: refresh tokens differ (the production 500).
    const [t1, t2] = await Promise.all([generateRefreshToken(USER), generateRefreshToken(USER)])
    assert.notStrictEqual(t1, t2, 'two refresh tokens in the same second must differ')

    // 2. Normal rotation: old revoked, one new active row, device info carried over.
    const old = await seed()
    const a = await rotateRefreshToken(old, USER, undefined, db)
    assert.ok(a, 'first rotation succeeds')
    const rows = await active()
    assert.deepStrictEqual(rows.map((r) => r.token), [a!.refreshToken], 'only the new token is active')
    assert.strictEqual(rows[0].user_agent, 'Seed UA', 'device info carried forward')

    // 3. Same old token again (the request that lost the race): same refresh token back, no new row.
    const b = await rotateRefreshToken(old, USER, undefined, db)
    assert.ok(b, 'lost race still succeeds')
    assert.strictEqual(b!.refreshToken, a!.refreshToken, 'lost race gets the winner\'s token')
    assert.strictEqual((await active()).length, 1, 'no extra session row')

    // 4. Two refreshes of one token started together: both succeed with the same token.
    const old2 = await seed()
    const [c, d] = await Promise.all([
      rotateRefreshToken(old2, USER, { userAgent: 'Tab A' }, db),
      rotateRefreshToken(old2, USER, { userAgent: 'Tab B' }, db),
    ])
    assert.ok(c && d, 'both concurrent refreshes succeed')
    assert.strictEqual(c!.refreshToken, d!.refreshToken, 'concurrent refreshes agree on one token')
    assert.strictEqual((await active()).length, 2, 'one new row per rotated token')

    // 5. The replacement itself was revoked (logout) -> the old token is dead.
    await db`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = ${c!.refreshToken}`
    assert.strictEqual(await rotateRefreshToken(old2, USER, undefined, db), null, 'no resurrection after logout')

    // 6. Revoked with no replacement (signed out), expired, unknown, wrong user -> null.
    assert.strictEqual(await rotateRefreshToken(await seed({ revokedAgoSec: 40 }), USER, undefined, db), null, 'signed out: no replacement')

    // 7. Lost reply: the refresh happened but its cookie never reached the
    //    browser, which comes back 15 minutes later with the old token. It
    //    gets the unused replacement instead of being signed out.
    const old3 = await seed()
    const e = await rotateRefreshToken(old3, USER, undefined, db)
    assert.ok(e)
    // Move a rotation (old row's revoked_at and its replacement's created_at,
    // which are equal) back in time, in SQL so the microseconds still match.
    const backdate = async (old: string, secs: number) => {
      await db`
        UPDATE refresh_tokens n SET created_at = n.created_at - make_interval(secs => ${secs}::int)
        FROM refresh_tokens o
        WHERE o.token = ${old} AND n.user_id = o.user_id AND n.created_at = o.revoked_at AND n.id <> o.id`
      await db`UPDATE refresh_tokens SET revoked_at = revoked_at - make_interval(secs => ${secs}::int) WHERE token = ${old}`
    }
    await backdate(old3, 15 * 60)
    const late = await rotateRefreshToken(old3, USER, undefined, db)
    assert.ok(late, 'lost reply 15 minutes later still succeeds')
    assert.strictEqual(late!.refreshToken, e!.refreshToken, 'and gets the unused replacement')

    // 8. Once the replacement has been used, the old token is dead.
    const f = await rotateRefreshToken(e!.refreshToken, USER, undefined, db)
    assert.ok(f)
    assert.strictEqual(await rotateRefreshToken(old3, USER, undefined, db), null, 'replacement already used')

    // 9. Past the window, even an unused replacement isn't handed out.
    const old4 = await seed()
    assert.ok(await rotateRefreshToken(old4, USER, undefined, db))
    await backdate(old4, REFRESH_REPLACEMENT_WINDOW_SEC + 60)
    assert.strictEqual(await rotateRefreshToken(old4, USER, undefined, db), null, 'past the window')
    assert.strictEqual(await rotateRefreshToken(await seed({ expired: true }), USER, undefined, db), null, 'expired')
    assert.strictEqual(await rotateRefreshToken('never-issued', USER, undefined, db), null, 'unknown')
    assert.strictEqual(await rotateRefreshToken(await seed({ user: 'someone-else' }), USER, undefined, db), null, 'wrong user')

    console.log('refresh rotation tests passed')
  } finally {
    await client.query(`DROP TABLE IF EXISTS pg_temp.refresh_tokens`).catch(() => {})
    client.release()
    await pool.end()
  }
}
main().catch((e) => { console.log('FAILED', e.message); process.exit(1) })
