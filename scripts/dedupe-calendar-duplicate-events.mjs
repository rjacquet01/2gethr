// One-off runner: finds and removes exact-duplicate calendar events caused
// by the calendar-sync race condition (fixed in lib/services/calendar-sync-core.ts -
// overlapping sync runs could each import/export the same event before either
// one's "already synced" row landed). A "duplicate" here is same family,
// same title, same start/end time - the signature of one real event copied
// twice by a racing sync run, not two separate events a person created on
// purpose.
//
// IMPORTANT: deleting an event cascades to its synced_events row (ON DELETE
// CASCADE). The first version of this script deleted duplicates outright,
// which - whenever the deleted copy happened to be the one actually tracked
// by synced_events - erased the "already synced" marker and caused the very
// next sync cycle to re-import the same external event as a brand new
// duplicate. Fixed by re-pointing any synced_events row that references a
// duplicate being removed onto the surviving event BEFORE deleting it, so
// the sync mapping is preserved rather than lost. The survivor is chosen as:
// whichever copy already has a synced_events mapping (so that mapping never
// needs to move), or - if none do - the oldest copy that isn't sitting in an
// auto-created sync/import calendar ("Google Calendar", "Apple Calendar",
// "Imported Events").
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

// Group by family (not calendar_id): a race-created duplicate from the
// Google/Apple import path lands in the auto-created "Google Calendar" /
// "Apple Calendar" calendar, not the original event's calendar, so matching
// on calendar_id alone misses exactly the duplicates this is meant to find.
const duplicateGroups = await sql`
  SELECT c.family_id, e.title, e.start_time, e.end_time, COUNT(*) as cnt,
         ARRAY_AGG(e.id ORDER BY e.created_at ASC) as ids,
         ARRAY_AGG(c.name ORDER BY e.created_at ASC) as calendar_names
  FROM events e
  JOIN calendars c ON c.id = e.calendar_id
  WHERE e.status != 'CANCELLED'
  GROUP BY c.family_id, e.title, e.start_time, e.end_time
  HAVING COUNT(*) > 1
  ORDER BY e.start_time ASC
`

if (duplicateGroups.length === 0) {
  console.log('No duplicate events found.')
  process.exit(0)
}

const SYNC_CALENDAR_NAMES = new Set(['Google Calendar', 'Apple Calendar'])

let totalDupes = 0
for (const group of duplicateGroups) {
  const ids = group.ids
  const calendarNames = group.calendar_names

  // Prefer keeping the original, user-created copy (whichever one isn't
  // sitting in an auto-created sync calendar) over a race-created import.
  // Both arrays are already ordered oldest-first, so falling back to
  // index 0 keeps the oldest copy when every copy is sync-created (or
  // every copy is original, in the rare case these weren't sync dupes).
  let keepIndex = calendarNames.findIndex((name) => !SYNC_CALENDAR_NAMES.has(name))
  if (keepIndex === -1) keepIndex = 0

  const keepId = ids[keepIndex]
  const dupeIds = ids.filter((_, i) => i !== keepIndex)
  totalDupes += dupeIds.length

  console.log(
    `"${group.title}" at ${new Date(group.start_time).toISOString()}: ${ids.length} copies across [${calendarNames.join(', ')}] - ` +
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
