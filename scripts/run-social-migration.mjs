// One-off runner: applies add-social-tables.sql directly against the
// project's own Neon database, using the same DATABASE_URL the app itself
// uses (read from .env.local) and the same @neondatabase/serverless driver
// already in package.json. Mirrors run-age-transitions-migration.mjs.
//
// Every statement is IF NOT EXISTS, so re-running it is harmless. The app also
// creates these lazily (ensureSocialTables in lib/social.ts).
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

const migrationPath = 'scripts/add-social-tables.sql'
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
    console.log(`OK: ${stmt.split('\n')[0].slice(0, 90)}`)
  } catch (err) {
    console.error(`FAILED: ${stmt.split('\n')[0].slice(0, 90)}`)
    console.error(err.message || err)
    process.exit(1)
  }
}

const indexes = await sql(`
  SELECT tablename, indexname FROM pg_indexes
  WHERE tablename IN ('event_comments','family_posts','family_post_comments','social_push_log')
  ORDER BY tablename, indexname
`)
console.log('\nIndexes:')
for (const t of indexes) console.log(`  ${t.tablename}: ${t.indexname}`)
const col = await sql(`SELECT 1 FROM information_schema.columns WHERE table_name = 'family_members' AND column_name = 'board_last_seen_at'`)
console.log(`family_members.board_last_seen_at: ${col.length ? 'present' : 'MISSING'}`)
console.log('Done - event comments and family board tables are ready.')
