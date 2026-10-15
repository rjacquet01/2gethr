// One-off runner: applies add-guest-adult-roles.sql directly against the
// project's own Neon database, using the same DATABASE_URL the app itself
// uses (read from .env.local) and the same @neondatabase/serverless driver
// already in package.json. Mirrors run-places-notify-migration.mjs.
//
// Each ALTER TYPE ... ADD VALUE is sent as its own request (autocommit, no
// surrounding transaction), and IF NOT EXISTS makes re-running it harmless.
import { readFileSync, existsSync } from 'fs'
import { neon } from '@neondatabase/serverless'

function loadEnvLocal() {
  const candidates = ['.env.local', '.env']
  const path = candidates.find(existsSync)
  if (!path) {
    console.error('Could not find .env.local or .env in the current directory. Run this from the 2gethr project root.')
    process.exit(1)
  }
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvLocal()

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not found in .env.local')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

const migrationPath = 'scripts/add-guest-adult-roles.sql'
const raw = readFileSync(migrationPath, 'utf8')

// Drop comment lines first so a leading comment block doesn't swallow the
// first statement.
const statements = raw
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0)

for (const stmt of statements) {
  try {
    await sql(stmt)
    console.log(`OK: ${stmt.split('\n')[0].slice(0, 70)}`)
  } catch (err) {
    console.error(`FAILED: ${stmt.split('\n')[0].slice(0, 70)}`)
    console.error(err.message || err)
    process.exit(1)
  }
}

const rows = await sql(`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'family_role'::regtype ORDER BY enumsortorder`)
console.log(`\nfamily_role values: ${rows.map(r => r.enumlabel).join(', ')}`)
console.log('Done - GUEST and ADULT member roles are ready.')
