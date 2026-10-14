// One-off runner: applies reminders-migration.sql directly against the
// project's own Neon database, using the same DATABASE_URL the app itself
// uses (read from .env.local) and the same @neondatabase/serverless driver
// already in package.json - no new dependency, no pasting into the Neon
// web UI.
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

const migrationPath = `${process.env.USERPROFILE}\\Downloads\\reminders-migration.sql`
const raw = readFileSync(migrationPath, 'utf8')

// Naive split on statement-terminating semicolons - safe here since the
// migration has no semicolons inside string literals.
const statements = raw
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

const results = []
for (const stmt of statements) {
  try {
    await sql(stmt)
    results.push({ stmt: stmt.split('\n')[0].slice(0, 60), ok: true })
    console.log(`OK: ${stmt.split('\n')[0].slice(0, 70)}`)
  } catch (err) {
    // ALTER TYPE ... ADD VALUE IF NOT EXISTS on a value that already
    // exists is a no-op in Postgres, not an error - but if this migration
    // is re-run after a partial failure, surface everything else as a
    // hard stop so nothing is silently skipped.
    console.error(`FAILED: ${stmt.split('\n')[0].slice(0, 70)}`)
    console.error(err.message || err)
    process.exit(1)
  }
}

console.log(`\nDone - ${results.length} statement(s) applied.`)
