// One-off runner: applies add-age-transitions.sql directly against the
// project's own Neon database, using the same DATABASE_URL the app itself
// uses (read from .env.local) and the same @neondatabase/serverless driver
// already in package.json. Mirrors run-guest-adult-roles-migration.mjs.
//
// Every statement is ADD COLUMN IF NOT EXISTS, so re-running it is harmless.
// The app also adds these columns lazily (lib/age-schema.ts and
// ensureInviteTables), so this just gets them in place ahead of time.
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

const migrationPath = 'scripts/add-age-transitions.sql'
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

const cols = await sql(`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE (table_name = 'child_profiles' AND column_name IN ('date_of_birth','turning18_notice_sent_at','adult_prompt_last_sent_at','adult_prompt_count','adult_prompt_snoozed_until'))
     OR (table_name = 'family_invites' AND column_name IN ('child_member_id','consent_by','consent_at'))
  ORDER BY table_name, column_name
`)
console.log(`\nPresent: ${cols.map(c => `${c.table_name}.${c.column_name}`).join(', ')}`)
console.log('Done - age transition columns are ready.')
