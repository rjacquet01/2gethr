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
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
