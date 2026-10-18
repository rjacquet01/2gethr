import { sql } from "./db"

// The saved_places.notify_channels column ("Notify me via" for geofence alerts)
// was added by scripts/add-notify-channels-to-places.sql, which was never run
// on production. Without it editing/creating a place and the geofence check
// all failed. Add it idempotently the first time any place code runs.
let ensured: Promise<void> | null = null

export function ensurePlaceNotifyChannelsColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS notify_channels TEXT[]`
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS photo_path TEXT`
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS photo_url TEXT`
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS created_by_id TEXT`
      // Arrival/departure events before this time don't count toward who is
      // "inside" (set when the place is turned on/off, moved or resized).
      await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS geofence_state_reset_at TIMESTAMPTZ`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
