// Usage: npx tsx scripts/test-data-export.ts <email>
// Read-only. Runs the account data export for one user and prints a summary.
// Dev branch only (scripts/dev-db.ts).
import './dev-db'

async function main() {
  const email = process.argv[2]
  if (!email) throw new Error('usage: test-data-export.ts <email>')
  const { sql } = await import('../lib/db')
  const { collectUserExport } = await import('../lib/data-export')
  const u = await sql`SELECT id FROM users WHERE email = ${email}`
  if (!u.length) throw new Error('user not found')
  const t0 = Date.now()
  const data = await collectUserExport(u[0].id as string, 'json')
  console.log(`export built in ${Date.now() - t0} ms`)
  for (const s of data.manifest.sections) console.log(`${String(s.rows).padStart(7)}  ${s.name}${s.truncated ? ' (truncated)' : ''}`)
  console.log('errors:', data.manifest.errors.length)
  data.manifest.errors.forEach((e) => console.log('  ERROR', e.section, '-', e.message))
  const json = JSON.stringify(data)
  console.log('json size (KB):', Math.round(json.length / 1024))
  // Secret leak check
  const bad = ['password_hash', 'two_factor_secret', 'backup_codes', 'token_hash', 'refresh_token', 'access_token_encrypted', 'p256dh']
  const leaks = bad.filter((k) => json.includes(`"${k}"`))
  console.log('secret keys present:', leaks.length ? leaks.join(',') : 'none')
  if (data.manifest.errors.length || leaks.length) process.exit(2)
}
main().catch((e) => { console.log('FAILED', e.message); process.exit(1) })
