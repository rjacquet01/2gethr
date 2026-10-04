// One-off runner: finds and removes exact-duplicate calendar events caused
// by the calendar-sync race condition (fixed in lib/services/calendar-sync-core.ts -
// overlapping sync runs could each import/export the same event before either
// one's "already synced" row landed). A "duplicate" here is same calendar,
// same title, same start/end time - the signature of one real event copied
// twice by a racing sync run, not two separate events a person created on
// purpose. Keeps the oldest row in each group, deletes the rest. Deleting an
// event cascades to its synced_events row automatically (ON DELETE CASCADE),
// so no separate sync-mapping cleanup is needed.
//
// Usage:
//   node scripts/dedupe-calendar-duplicate-events.mjs --dry-run   (report only)
//   node scripts/dedupe-calendar-duplicate-events.mjs             (actually delete)
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
const dryRun = process.argv.includes('--dry-run')

const duplicateGroups = await sql`
  SELECT calendar_id, title, start_time, end_time, COUNT(*) as cnt,
         ARRAY_AGG(id ORDER BY created_at ASC) as ids
  FROM events
  WHERE status != 'CANCELLED'
  GROUP BY calendar_id, title, start_time, end_time
  HAVING COUNT(*) > 1
  ORDER BY start_time ASC
`

if (duplicateGroups.length === 0) {
  console.log('No duplicate events found.')
  process.exit(0)
}

let totalDupes = 0
for (const group of duplicateGroups) {
  const ids = group.ids
  const [keepId, ...dupeIds] = ids
  totalDupes += dupeIds.length
  console.log(
    `"${group.title}" at ${new Date(group.start_time).toISOString()}: ${ids.length} copies - ` +
      `keeping ${keepId}, ${dryRun ? 'would delete' : 'deleting'} [${dupeIds.join(', ')}]`
  )
  if (!dryRun) {
    await sql`DELETE FROM events WHERE id = ANY(${dupeIds})`
  }
}

if (dryRun) {
  console.log(`\nDry run - found ${duplicateGroups.length} duplicate group(s), ${totalDupes} extra event(s) total.`)
  console.log('Re-run without --dry-run to actually delete the extras.')
} else {
  console.log(`\nDone - removed ${totalDupes} duplicate event(s) across ${duplicateGroups.length} group(s).`)
}
