import { sql } from "./db"
import { scopeUserIds } from "./legal"

export type Section = "account" | "location" | "geofence" | "requests" | "activity"
export const SECTIONS: Section[] = ["account", "location", "geofence", "requests", "activity"]
const PAGE = 5000

// Read-only collectors. Every query is limited to the case's users and date range.
export async function collect(c: any, section: Section, offset = 0, limit = PAGE) {
  const ids = await scopeUserIds(c)
  const from = new Date(c.scope_from).toISOString()
  const to = new Date(c.scope_to).toISOString()
  if (ids.length === 0) return { rows: [] as any[], total: 0 }

  switch (section) {
    case "account": {
      const users = await sql`
        SELECT id, email, first_name, last_name, phone, date_of_birth, timezone, is_active, created_at, last_login_at
        FROM users WHERE id = ANY(${ids}::text[])
      `
      const members = c.scope_family_id
        ? await sql`
            SELECT fm.user_id, fm.family_id, f.name AS family_name, fm.role, fm.nickname, fm.is_active, fm.joined_at
            FROM family_members fm JOIN families f ON f.id = fm.family_id
            WHERE fm.user_id = ANY(${ids}::text[]) AND fm.family_id = ${c.scope_family_id}
          `
        : await sql`
            SELECT fm.user_id, fm.family_id, f.name AS family_name, fm.role, fm.nickname, fm.is_active, fm.joined_at
            FROM family_members fm JOIN families f ON f.id = fm.family_id
            WHERE fm.user_id = ANY(${ids}::text[])
          `
      return { rows: [{ users, memberships: members }], total: users.length }
    }
    case "location": {
      const total = await sql`
        SELECT COUNT(*)::int AS n FROM location_pings
        WHERE user_id = ANY(${ids}::text[]) AND timestamp >= ${from} AND timestamp <= ${to}
      `
      const rows = await sql`
        SELECT user_id, latitude, longitude, accuracy, speed, heading, battery_level, timestamp
        FROM location_pings
        WHERE user_id = ANY(${ids}::text[]) AND timestamp >= ${from} AND timestamp <= ${to}
        ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}
      `
      return { rows, total: total[0]?.n || 0 }
    }
    case "geofence": {
      const rows = await sql`
        SELECT g.user_id, p.name AS place_name, g.event_type, g.latitude, g.longitude, g.timestamp
        FROM geofence_events g LEFT JOIN saved_places p ON p.id = g.saved_place_id
        WHERE g.user_id = ANY(${ids}::text[]) AND g.timestamp >= ${from} AND g.timestamp <= ${to}
        ORDER BY g.timestamp DESC LIMIT ${limit} OFFSET ${offset}
      `
      return { rows, total: rows.length }
    }
    case "requests": {
      const rows = await sql`
        SELECT requester_user_id, target_user_id, family_id, status, created_at, fulfilled_at,
               snapshot_lat, snapshot_lng, snapshot_accuracy, snapshot_at
        FROM location_requests
        WHERE (target_user_id = ANY(${ids}::text[]) OR requester_user_id = ANY(${ids}::text[]))
          AND created_at >= ${from} AND created_at <= ${to}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
      return { rows, total: rows.length }
    }
    case "activity": {
      const rows = await sql`
        SELECT user_id, action, entity_type, ip_address, user_agent, created_at
        FROM audit_logs
        WHERE user_id = ANY(${ids}::text[]) AND created_at >= ${from} AND created_at <= ${to}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
      return { rows, total: rows.length }
    }
  }
}
