import { sql } from "./db"
import { scopeUserIds } from "./legal"

export type Section = "account" | "location" | "geofence" | "requests" | "activity" | "devices" | "safety" | "places" | "billing"
export const SECTIONS: Section[] = ["account", "location", "geofence", "requests", "activity", "devices", "safety", "places", "billing"]
const PAGE = 5000

/** A table some installs create lazily on first use: missing means no rows. */
async function optional<T>(q: () => Promise<T[]>): Promise<T[]> {
  try {
    return await q()
  } catch (e) {
    if (/does not exist/i.test(String((e as Error)?.message))) return []
    throw e
  }
}

/** The case's family, or (for a person-only case) the families they belong to. */
async function scopeFamilyIds(c: any, ids: string[]): Promise<string[]> {
  if (c.scope_family_id) return [c.scope_family_id]
  const r = await sql`SELECT DISTINCT family_id FROM family_members WHERE user_id = ANY(${ids}::text[])`
  return r.map((x: any) => x.family_id)
}

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
    case "devices": {
      // Sessions and devices with IPs; never token values or hashes.
      const sessions = await sql`
        SELECT user_id, ip_address, user_agent, created_at, expires_at, revoked_at
        FROM refresh_tokens
        WHERE user_id = ANY(${ids}::text[]) AND created_at >= ${from} AND created_at <= ${to}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
      const signIns = await sql`
        SELECT user_id, email, ip, created_at
        FROM login_attempts
        WHERE user_id = ANY(${ids}::text[]) AND created_at >= ${from} AND created_at <= ${to}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
      const pushDevices = await sql`
        SELECT user_id, platform, device_info, is_active, created_at, last_used_at
        FROM push_tokens WHERE user_id = ANY(${ids}::text[]) ORDER BY created_at DESC
      `
      const locationDevices = await sql`
        SELECT user_id, family_id, created_at, last_used_at, revoked_at
        FROM location_device_tokens WHERE user_id = ANY(${ids}::text[]) ORDER BY created_at DESC
      `
      return {
        rows: [{ sessions, signIns, pushDevices, locationDevices }],
        total: sessions.length + signIns.length + pushDevices.length + locationDevices.length,
      }
    }
    case "safety": {
      const sos = await sql`
        SELECT user_id, family_id, latitude, longitude, location_source, message, created_at
        FROM sos_events
        WHERE user_id = ANY(${ids}::text[]) AND created_at >= ${from} AND created_at <= ${to}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
      const emergencyAlerts = await optional(() => sql`
        SELECT family_id, sender_user_id, child_user_id, created_at, acked_at
        FROM emergency_alerts
        WHERE (sender_user_id = ANY(${ids}::text[]) OR child_user_id = ANY(${ids}::text[]))
          AND created_at >= ${from} AND created_at <= ${to}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `)
      return { rows: [{ sos, emergencyAlerts }], total: sos.length + emergencyAlerts.length }
    }
    case "places": {
      // Saved places as they are now (home, school...): what place alerts refer to.
      const families = await scopeFamilyIds(c, ids)
      const rows = families.length
        ? await sql`
            SELECT family_id, name, address, latitude, longitude, radius, geofence_enabled, created_by_id, created_at, updated_at
            FROM saved_places WHERE family_id = ANY(${families}::text[])
            ORDER BY family_id, name LIMIT ${limit} OFFSET ${offset}
          `
        : []
      return { rows, total: rows.length }
    }
    case "billing": {
      // Subscriber records for families the covered people own (or the case's family).
      const owned = c.scope_family_id
        ? [c.scope_family_id]
        : (await sql`SELECT id FROM families WHERE owner_id = ANY(${ids}::text[])`).map((x: any) => x.id)
      if (owned.length === 0) return { rows: [{ families: [], subscriptions: [], payments: [] }], total: 0 }
      const families = await sql`SELECT id, name, owner_id, created_at FROM families WHERE id = ANY(${owned}::text[])`
      const subscriptions = await sql`
        SELECT family_id, tier, status, stripe_customer_id, stripe_subscription_id, current_period_start,
               current_period_end, cancel_at_period_end, trial_ends_at, created_at, updated_at
        FROM subscriptions WHERE family_id = ANY(${owned}::text[]) ORDER BY created_at DESC
      `
      const payments = await sql`
        SELECT s.family_id, pt.stripe_payment_id, pt.amount, pt.currency, pt.status, pt.description, pt.created_at
        FROM payment_transactions pt JOIN subscriptions s ON s.id = pt.subscription_id
        WHERE s.family_id = ANY(${owned}::text[]) AND pt.created_at >= ${from} AND pt.created_at <= ${to}
        ORDER BY pt.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
      return { rows: [{ families, subscriptions, payments }], total: subscriptions.length + payments.length }
    }
  }
}
