import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { sendSMS, SMS_TEMPLATES, isTwilioConfigured } from "@/lib/services/sms"
import { sendEmail, EMAIL_TEMPLATES, isResendConfigured } from "@/lib/services/email"
import { sendPushToUser, isFirebaseConfigured } from "@/lib/services/push"
import { distanceMeters, evaluateGeofence, suggestedPingIntervalSec } from "@/lib/geofence"

const locationPingSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional().nullable(),
  altitude: z.number().optional().nullable(),
  speed: z.number().min(0).optional().nullable(),
  heading: z.number().min(0).max(360).optional().nullable(),
  batteryLevel: z.number().int().min(0).max(100).optional().nullable(),
  timestamp: z.string().datetime().optional().nullable(),
  memberId: z.string().optional().nullable(),
  familyId: z.string().optional().nullable(),
})

// Get family members' locations (for authorized users)
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const familyId = request.nextUrl.searchParams.get("familyId") || user.primaryFamily?.id

    if (!familyId) {
      return NextResponse.json(
        { success: false, error: "No family specified" },
        { status: 400 }
      )
    }

    // Verify user is a PARENT or GUARDIAN in this family
    const membership = await sql`
      SELECT role FROM family_members 
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json(
        { success: false, error: "Not a member of this family" },
        { status: 403 }
      )
    }

    const userRole = membership[0].role
    const isParentOrGuardian = userRole === "PARENT" || userRole === "GUARDIAN"

    // Check subscription allows location sharing (Premium only)
    const subscription = await checkFamilySubscription(familyId)
    if (!subscription.features.locationSharing) {
      return NextResponse.json(
        { success: false, error: "Location sharing requires a Premium subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      )
    }

    // Get members with their location settings and pings
    const locations = await sql`
      SELECT 
        fm.id as member_id, fm.user_id, fm.nickname, fm.role,
        COALESCE(ls.mode, 'OFF') as location_mode, 
        COALESCE(ls.share_with_family, false) as share_with_family,
        lp.latitude, lp.longitude, lp.accuracy, lp.altitude,
        lp.speed, lp.heading, lp.battery_level, lp.timestamp,
        u.first_name, u.last_name, u.profile_photo_path,
        cp.display_name as child_display_name
      FROM family_members fm
      LEFT JOIN location_settings ls ON fm.id = ls.family_member_id
      LEFT JOIN LATERAL (
        SELECT * FROM location_pings 
        WHERE user_id = fm.user_id 
        ORDER BY timestamp DESC 
        LIMIT 1
      ) lp ON true
      LEFT JOIN users u ON fm.user_id = u.id
      LEFT JOIN child_profiles cp ON fm.id = cp.family_member_id
      WHERE fm.family_id = ${familyId}
      AND fm.is_active = true
    `
    
    // Filter based on role:
    // - Parents/guardians can see all family members who have share_with_family enabled
    // - Children can only see family members who share their location (parents sharing with them)
    const filteredLocations = locations.filter(l => {
      // Must have share_with_family enabled and not be OFF
      if (l.share_with_family !== true || l.location_mode === 'OFF') {
        return false
      }
      // If user is a child, only show parents/guardians who are sharing
      if (!isParentOrGuardian) {
        return l.role === 'PARENT' || l.role === 'GUARDIAN'
      }
      return true
    })

    return NextResponse.json({
      success: true,
      data: filteredLocations.map(l => ({
        memberId: l.member_id,
        userId: l.user_id,
        name: l.child_display_name || l.nickname || `${l.first_name} ${l.last_name}`,
        role: l.role,
        profilePhotoPath: l.profile_photo_path,
        locationMode: l.location_mode,
        location: l.latitude !== null && l.longitude !== null ? {
          latitude: l.latitude,
          longitude: l.longitude,
          accuracy: l.accuracy,
          altitude: l.altitude,
          speed: l.speed,
          heading: l.heading,
          batteryLevel: l.battery_level,
          timestamp: l.timestamp,
        } : null,
      })),
    })
  } catch (error) {
    console.error("Get locations error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get locations" },
      { status: 500 }
    )
  }
}

// Post location ping (from mobile app)
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = locationPingSchema.parse(body)

    // Build query to find the correct location settings
    // If memberId/familyId provided, use those; otherwise fall back to first match
    let settings
    if (validatedData.memberId && validatedData.familyId) {
      settings = await sql`
        SELECT ls.mode, ls.share_with_family, fm.family_id, fm.id as member_id
        FROM location_settings ls
        JOIN family_members fm ON ls.family_member_id = fm.id
        WHERE fm.id = ${validatedData.memberId}
          AND fm.family_id = ${validatedData.familyId}
          AND fm.user_id = ${user.id}
          AND fm.is_active = true
        LIMIT 1
      `
    } else {
      settings = await sql`
        SELECT ls.mode, ls.share_with_family, fm.family_id, fm.id as member_id
        FROM location_settings ls
        JOIN family_members fm ON ls.family_member_id = fm.id
        WHERE fm.user_id = ${user.id} AND fm.is_active = true
        LIMIT 1
      `
    }

    if (settings.length === 0) {
      return NextResponse.json(
        { success: false, error: "No location settings found" },
        { status: 400 }
      )
    }

    const setting = settings[0]

    // Check if location sharing is enabled and mode allows sharing
    if (!setting.share_with_family || setting.mode === "OFF" || setting.mode === "PAUSED") {
      return NextResponse.json(
        { success: false, error: "Location sharing is disabled" },
        { status: 400 }
      )
    }

    // Check subscription
    const subscription = await checkFamilySubscription(setting.family_id)
    if (!subscription.features.locationSharing) {
      return NextResponse.json(
        { success: false, error: "Location sharing requires the Premium plan", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      )
    }

    // Previous ping (before this one is stored) - used to require two
    // consecutive "outside" fixes before declaring a departure, so a single
    // wild GPS/Wi-Fi outlier can't trigger a false "left" alert.
    const prevPings = await sql`
      SELECT latitude, longitude, timestamp FROM location_pings
      WHERE user_id = ${user.id}
      ORDER BY timestamp DESC
      LIMIT 1
    `
    const prevPing = prevPings[0]
      ? {
          latitude: Number(prevPings[0].latitude),
          longitude: Number(prevPings[0].longitude),
          ageSec: (Date.now() - new Date(prevPings[0].timestamp).getTime()) / 1000,
        }
      : null

    // Store location ping - use text-based ID to match column type
    const pingId = `ping_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    await sql`
      INSERT INTO location_pings (
        id, user_id, latitude, longitude, accuracy, altitude,
        speed, heading, battery_level, timestamp
      )
      VALUES (
        ${pingId},
        ${user.id},
        ${validatedData.latitude},
        ${validatedData.longitude},
        ${validatedData.accuracy || null},
        ${validatedData.altitude || null},
        ${validatedData.speed || null},
        ${validatedData.heading || null},
        ${validatedData.batteryLevel || null},
        ${validatedData.timestamp || new Date().toISOString()}
      )
    `

    // Free tier gets live location only, not history: keep just the latest ping.
    if (subscription.tier === "FREE") {
      await sql`DELETE FROM location_pings WHERE user_id = ${user.id} AND id != ${pingId}`
    }

    // Check geofences if enabled (Premium feature)
    let suggestedIntervalSec: number | null = null
    if (subscription.features.geofencing) {
      const gap = await checkGeofences(
        user.id,
        setting.family_id,
        validatedData.latitude,
        validatedData.longitude,
        validatedData.accuracy,
        prevPing
      )
      suggestedIntervalSec = suggestedPingIntervalSec(gap)
    }

    // Keep paid-plan history within the plan's window. Runs on ~2% of pings
    // so it doesn't add a write to every ping.
    if (subscription.tier !== "FREE" && Math.random() < 0.02) {
      await sql`
        DELETE FROM location_pings
        WHERE user_id = ${user.id}
          AND timestamp < NOW() - make_interval(days => ${subscription.features.historyDays})
      `
    }

    return NextResponse.json({
      success: true,
      data: { pingId, suggestedIntervalSec },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Location ping error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to record location" },
      { status: 500 }
    )
  }
}

async function checkGeofences(
  userId: string,
  familyId: string,
  latitude: number,
  longitude: number,
  accuracy?: number | null,
  prevPing?: { latitude: number; longitude: number; ageSec: number } | null
): Promise<number | null> {
  // Get all geofence-enabled places for this family
  const places = await sql`
    SELECT id, name, latitude, longitude, radius, alert_on_arrival, alert_on_departure, notify_channels
    FROM saved_places
    WHERE family_id = ${familyId} AND geofence_enabled = true
  `
  if (places.length === 0) return null

  // Last arrival/departure state per place for this user, in one query.
  const lastRows = await sql`
    SELECT DISTINCT ON (saved_place_id) saved_place_id, event_type
    FROM geofence_events
    WHERE user_id = ${userId}
    ORDER BY saved_place_id, timestamp DESC
  `
  const lastByPlace = new Map<string, string>()
  for (const r of lastRows) lastByPlace.set(r.saved_place_id, r.event_type)

  let nearestGap: number | null = null

  for (const place of places) {
    const radius = Number(place.radius)
    const distance = distanceMeters(latitude, longitude, Number(place.latitude), Number(place.longitude))
    const gap = distance - radius
    if (nearestGap === null || gap < nearestGap) nearestGap = gap

    const wasInside = lastByPlace.get(place.id) === "ARRIVAL"

    // Hysteresis + accuracy gating live in lib/geofence.ts (unit tested).
    const transition = evaluateGeofence({ distance, accuracy, radius, wasInside })
    if (!transition) continue

    // A departure also needs the previous fix (if it's recent) to be outside
    // the radius, so a one-off outlier fix can't fire a false "left".
    if (transition === "DEPARTURE" && prevPing && prevPing.ageSec < 600) {
      const prevDistance = distanceMeters(prevPing.latitude, prevPing.longitude, Number(place.latitude), Number(place.longitude))
      if (prevDistance <= radius) continue
    }

    // State is always recorded so arrival/departure tracking stays correct
    // even when only one of the two alerts is enabled (previously a place
    // with arrival alerts off could never report a departure). The insert is
    // skipped if the same event was just written, which stops two
    // overlapping pings from double-alerting.
    const recorded = await recordGeofenceEvent(userId, place.id, transition, latitude, longitude)
    if (!recorded) continue

    const wantsAlert = transition === "ARRIVAL" ? place.alert_on_arrival : place.alert_on_departure
    if (wantsAlert) {
      await createGeofenceNotification(userId, familyId, place.name, transition, place.notify_channels)
    }
  }

  return nearestGap
}

async function recordGeofenceEvent(
  userId: string,
  placeId: string,
  eventType: "ARRIVAL" | "DEPARTURE",
  latitude: number,
  longitude: number
): Promise<boolean> {
  const eventId = `gfe_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  const rows = await sql`
    INSERT INTO geofence_events (id, user_id, saved_place_id, event_type, latitude, longitude, timestamp)
    SELECT ${eventId}, ${userId}, ${placeId}, ${eventType}, ${latitude}, ${longitude}, NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM geofence_events
      WHERE user_id = ${userId} AND saved_place_id = ${placeId}
        AND event_type = ${eventType}
        AND timestamp > NOW() - INTERVAL '45 seconds'
    )
    RETURNING id
  `
  return rows.length > 0
}

async function createGeofenceNotification(
  userId: string,
  familyId: string,
  placeName: string,
  eventType: "ARRIVAL" | "DEPARTURE",
  notifyChannels: string[] | null
) {
  // Get user's name
  const users = await sql`SELECT first_name FROM users WHERE id = ${userId}`
  const userName = users[0]?.first_name || "Family member"

  // The place's own notify_channels (set via the "Notify me via" picker on
  // the Places page) decides which channels are even eligible for this
  // alert, mirroring the notify_channels picker already on
  // tasks/events/reminders. Null/empty (a place created before this column
  // existed, or with no explicit choice) means every channel is eligible -
  // each one is then still individually gated by the recipient's own
  // notification settings below, exactly as it always was.
  const wantsInApp = !notifyChannels || notifyChannels.length === 0 || notifyChannels.includes('in_app')
  const wantsPush = !notifyChannels || notifyChannels.length === 0 || notifyChannels.includes('push')
  const wantsSms = !notifyChannels || notifyChannels.length === 0 || notifyChannels.includes('sms')
  const wantsEmail = !notifyChannels || notifyChannels.length === 0 || notifyChannels.includes('email')

  // Get parents/guardians to notify (not just PARENT — a GUARDIAN can already
  // view this child's location and settings, so they should get the same
  // arrival/departure alerts), plus what we need to reach them on their
  // other channels (email/phone + their own notification toggles).
  //
  // NOTE: the family_role enum only defines PARENT, GUARDIAN, CHILD — there
  // is no ADMIN value. This used to also filter on role IN (..., 'ADMIN'),
  // which is harmless in a JS .includes() check elsewhere but fatal here:
  // comparing an enum column against a SQL literal forces Postgres to cast
  // the literal to the enum type, and 'ADMIN' has no such value, so the
  // query threw "invalid input value for enum family_role: ADMIN" on every
  // single arrival/departure — silently killing all geofence notifications
  // (in-app included) since the throw happened before any INSERT ran.
  const recipients = await sql`
    SELECT fm.user_id, u.email, u.phone, rs.email_enabled, rs.sms_enabled, rs.push_enabled
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN reminder_settings rs ON rs.user_id = fm.user_id
    WHERE fm.family_id = ${familyId}
      AND fm.role IN ('PARENT', 'GUARDIAN')
      AND fm.is_active = true
      AND fm.user_id != ${userId}
  `

  const actionVerb = eventType === "ARRIVAL" ? "arrived" : "left"
  const title = eventType === "ARRIVAL" ? `${userName} arrived` : `${userName} left`
  const body =
    eventType === "ARRIVAL"
      ? `${userName} has arrived at ${placeName}`
      : `${userName} has left ${placeName}`
  const timeStr = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })

  for (const recipient of recipients) {
    if (wantsInApp) {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      await sql`
        INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
        VALUES (
          ${notifId},
          ${recipient.user_id},
          'LOCATION_ALERT',
          ${title},
          ${body},
          ${JSON.stringify({ userId, placeName, eventType })}::jsonb,
          NOW()
        )
      `
    }

    // Push — geofence alerts never sent a real push before this; every
    // other notification type (tasks, events, reminders) already does via
    // this same sendPushToUser/isFirebaseConfigured pair in
    // lib/notifications.ts. Best-effort: a user with no active push
    // subscription just gets sent:0, and any failure is logged, not
    // thrown, so it can never take down the location ping that triggered
    // it. Gated on reminder_settings.push_enabled, the same column the
    // Settings page toggle writes to.
    const pushEnabled = recipient.push_enabled ?? true
    if (wantsPush && pushEnabled && isFirebaseConfigured()) {
      try {
        await sendPushToUser(recipient.user_id, {
          title,
          body,
          data: { type: "LOCATION_ALERT", placeName, eventType },
          clickAction: "/places",
        })
      } catch (err) {
        console.error("Geofence push threw:", err)
      }
    }

    // Email — same default as the Settings page (on unless the recipient
    // has explicitly turned it off there). A failure here must never take
    // down the location ping that triggered it, so it's caught and logged,
    // not thrown.
    const emailEnabled = recipient.email_enabled ?? true
    if (wantsEmail && emailEnabled && recipient.email && isResendConfigured()) {
      try {
        const content = EMAIL_TEMPLATES.GEOFENCE_ALERT(userName, actionVerb, placeName, timeStr)
        const result = await sendEmail({ to: recipient.email, ...content })
        if (!result.success) {
          console.error("Geofence email failed:", result.error)
        }
      } catch (err) {
        console.error("Geofence email threw:", err)
      }
    }

    // SMS — same default as the Settings page (off until the recipient sets
    // a phone number and flips "SMS Notifications" on there).
    const smsEnabled = recipient.sms_enabled === true
    if (wantsSms && smsEnabled && recipient.phone && isTwilioConfigured()) {
      try {
        const smsBody =
          eventType === "ARRIVAL"
            ? SMS_TEMPLATES.GEOFENCE_ARRIVAL(userName, placeName)
            : SMS_TEMPLATES.GEOFENCE_DEPARTURE(userName, placeName)
        const result = await sendSMS({ to: recipient.phone, body: smsBody })
        if (!result.success) {
          console.error("Geofence SMS failed:", result.error)
        }
      } catch (err) {
        console.error("Geofence SMS threw:", err)
      }
    }
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}
