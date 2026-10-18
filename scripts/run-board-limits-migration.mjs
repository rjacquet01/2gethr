// One-off runner: applies add-board-limits.sql against the project's Neon
// database (DATABASE_URL from .env.local), one statement at a time.
// Mirrors run-place-members-migration.mjs. Only adds nullable or defaulted
// columns and an index, so it is safe to run more than once.
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

const raw = readFileSync('scripts/add-board-limits.sql', 'utf8')

// Drop comment lines first: a statement preceded by comments would otherwise
// start with "--" and be skipped.
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

const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'family_posts' AND column_name IN ('taken_down_at', 'taken_down_reason', 'keep_up', 'expires_at')
`
console.log(`\nDone - family_posts has ${cols.length} of 4 board-limit columns.`)
