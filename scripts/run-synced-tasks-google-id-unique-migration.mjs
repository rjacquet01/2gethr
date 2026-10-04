// One-off runner: applies add-synced-tasks-google-id-unique.sql directly
// against the project's own Neon database. Mirrors run-ics-import-dedup-migration.mjs,
// but strips comment lines from the RAW file first and splits on ';' only
// after that. Stripping-then-splitting (rather than splitting-then-stripping)
// matters because a semicolon inside a prose comment - e.g. "(one Togethr
// task); this adds..." - would otherwise split the file mid-comment and
// strand the back half of a comment sentence as a bare statement fragment
// that still carries real SQL on later lines in the same chunk.
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

const migrationPath = 'scripts/add-synced-tasks-google-id-unique.sql'
const raw = readFileSync(migrationPath, 'utf8')

// Strip every comment line out of the whole file FIRST, then split on ';'.
// Splitting first (as the ics-import migration runner this was copied from
// does) breaks if a semicolon ever appears inside a comment's prose rather
// than only at statement ends - which this file's own comments do.
const withoutComments = raw
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')

const statements = withoutComments
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

console.log('\nDone - synced_tasks(connection_id, google_task_id) is now unique.')
