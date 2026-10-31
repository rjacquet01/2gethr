import { isUnderLegalHold } from "@/lib/legal"
import { ensureLocationRequestsTable } from "@/lib/location-schema"
import { NextRequest, NextResponse } from "next/server"
import { geofencePlacesFor } from "@/lib/geofence-places"
import { sql } from "@/lib/db"
import { getUserFromRequest, getUserWithFamily, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { verifyDeviceToken } from "@/lib/device-token"
import { z } from "zod"
import { sendSMSMetered, SMS_TEMPLATES, isSmsConfigured } from "@/lib/services/sms"
import { sendEmail, EMAIL_TEMPLATES, isResendConfigured } from "@/lib/services/email"
import { sendPushToUser, isFirebaseConfigured } from "@/lib/services/push"
import {
  distanceMeters,
  suggestedIntervalForGaps,
  planGeofenceTransitions,
  GEOFENCE_FIX_MAX_AGE_MS,
  toBoostPlaces,
  type GeofenceFix,
} from "@/lib/geofence"
import { shouldMergeWithPrevious, oneTimePingId, isOneTimePingId } from "@/lib/location-dedupe"
import { answerLocationRequests, fulfillLocationRequests } from "@/lib/location-schema"
import { alertFamilyAdults } from "@/lib/family-alerts"
import { memberName, nameInFamily } from "@/lib/member-names"
import { approvedOwnerMemberIds, needsAccessGrant, locationAudienceUserIds } from "@/lib/location-access"
import { ensureMemberAppearanceColumns } from "@/lib/member-appearance"
import { guestForbidden, isAdultMemberRole, isGuestInFamily, isGuestOnly } from "@/lib/permissions"
import { alertPlaceLimit } from "@/lib/place-alerts"

const pingFields = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional().nullable(),
  altitude: z.number().optional().nullable(),
  speed: z.number().min(0).optional().nullable(),
  heading: z.number().min(0).max(360).optional().nullable(),
  batteryLevel: z.number().int().min(0).max(100).optional().nullable(),
  timestamp: z.string().datetime().optional().nullable(),
}

const locationPingSchema = z.object({
  ...pingFields,
  memberId: z.string().optional().nullable(),
  familyId: z.string().optional().nullable(),
  // Fixes the device recorded while it was offline, oldest first. The
  // top-level fields above are always the newest fix.
  pings: z.array(z.object(pingFields)).max(200).optional(),
  // "Share now": a single fix sent on purpose. Lets a grown-up share once
  // while their sharing is off or paused, without changing that setting.
  once: z.boolean().optional(),
})

// How long a one-time "Share now" stays on the family map.
const ONE_TIME_SHARE_VISIBLE_MS = 60 * 60_000

// Get family members' locations (for authorized users)
export async function GET(request: NextRequest) {
  try {
    await ensureMemberAppearanceColumns()
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
      SELECT id, role FROM family_members
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json(
        { success: false, error: "Not a member of this family" },
        { status: 403 }
      )
    }

    const userRole = membership[0].role
    const myMemberId = membership[0].id as string
    if (userRole === "GUEST") return guestForbidden()
    // Grown-ups (PARENT / GUARDIAN / ADULT) see sharing children; other
    // grown-ups need approval (below). A child sees the grown-ups who share.
    const seesKids = isAdultMemberRole(userRole)

    // Independent of each other once membership is known, so one round trip
    // instead of four. The plan check still decides before anything is returned.
    const [subscription, locations, snapshots, approvedOwners] = await Promise.all([
      checkFamilySubscription(familyId),
      // Members with their location settings and latest ping
      sql`
        SELECT 
          fm.id as member_id, fm.user_id, fm.nickname, fm.role, fm.color, fm.emoji,
          COALESCE(ls.mode, 'OFF') as location_mode, 
          COALESCE(ls.share_with_family, false) as share_with_family,
          lp.id as ping_id, lp.latitude, lp.longitude, lp.accuracy, lp.altitude,
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
      `,
      ensureLocationRequestsTable().then(() => sql`
        SELECT lr.id, lr.snapshot_lat, lr.snapshot_lng, lr.snapshot_accuracy, lr.snapshot_at,
               fm.nickname, fm.role, u.first_name, u.last_name, cp.display_name AS child_display_name
        FROM location_requests lr
        JOIN family_members fm ON fm.user_id = lr.target_user_id AND fm.family_id = lr.family_id AND fm.is_active = true
        LEFT JOIN users u ON u.id = lr.target_user_id
        LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
        WHERE lr.requester_user_id = ${user.id} AND lr.family_id = ${familyId}
          AND lr.status = 'FULFILLED' AND lr.snapshot_lat IS NOT NULL
          AND lr.snapshot_at > NOW() - INTERVAL '60 minutes'
        ORDER BY lr.snapshot_at DESC
        LIMIT 10
      `),
      // Grown-ups see another grown-up only with that person's approval.
      isAdultMemberRole(userRole) ? approvedOwnerMemberIds(myMemberId) : Promise.resolve(new Set<string>()),
    ])
    if (!subscription.features.locationSharing) {
      return NextResponse.json(
        { success: false, error: "Location sharing requires a Premium subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      )
    }

    // Filter based on role:
    // - Grown-ups can see all family members who have share_with_family enabled
    // - Children can only see family members who share their location (parents sharing with them)
    // - Grown-ups see another grown-up only with an approved access grant
    const filteredLocations = locations.filter(l => {
      // Guests never take part in family location.
      if (l.role === 'GUEST') return false
      // Not even a "Share now": that reaches the kids and approved grown-ups only.
      if (needsAccessGrant(userRole, myMemberId, l.role, l.member_id) && !approvedOwners.has(l.member_id)) return false
      // Must have share_with_family enabled and not be OFF - except a
      // grown-up's "Share now" here (their newest fix is a one-time share
      // from this membership), shown for an hour like approved snapshots.
      const sharedOnce = l.role !== 'CHILD' && isOneTimePingId(l.ping_id, l.member_id) &&
        Date.now() - new Date(l.timestamp).getTime() < ONE_TIME_SHARE_VISIBLE_MS
      if ((l.share_with_family !== true || l.location_mode === 'OFF') && !sharedOnce) {
        return false
      }
      // Children only see the grown-ups who are sharing
      if (!seesKids) {
        return l.role === 'PARENT' || l.role === 'GUARDIAN' || l.role === 'ADULT'
      }
      return true
    })

    return NextResponse.json({
      success: true,
      data: filteredLocations.map(l => ({
        memberId: l.member_id,
        userId: l.user_id,
        name: memberName({ role: l.role, nickname: l.nickname, childDisplayName: l.child_display_name, firstName: l.first_name, lastName: l.last_name }, { withLastName: true }),
        role: l.role,
        hasAccount: !!l.user_id,
        color: l.color ?? null,
        emoji: l.emoji ?? null,
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
      // Everyone else in the family who can be asked for a one-time location
      // (even if their sharing is off). The recipient has to approve, except
      // a child pinged by a parent (app/api/location/request).
      // Guests take no part in this family's location (requests to them are
      // refused), so they aren't offered.
      pingable: locations
        .filter(l => l.user_id && l.user_id !== user.id && l.role !== 'GUEST')
        .map(l => ({
          memberId: l.member_id,
          name: memberName({ role: l.role, nickname: l.nickname, childDisplayName: l.child_display_name, firstName: l.first_name, lastName: l.last_name }, { withLastName: true }),
          role: l.role,
          hasAccount: true,
          color: l.color ?? null,
          emoji: l.emoji ?? null,
        })),
      // Kids with no login have no phone to share from or approve a ping, so
      // they appear in neither list above. Grown-ups get them here so
      // the page can say "No account" instead of leaving them out silently.
      noAccountChildren: seesKids
        ? locations
            .filter(l => l.role === 'CHILD' && !l.user_id)
            .map(l => ({
              memberId: l.member_id,
              name: memberName({ role: l.role, nickname: l.nickname, childDisplayName: l.child_display_name }, { fallback: 'Child' }),
              hasAccount: false,
              color: l.color ?? null,
              emoji: l.emoji ?? null,
            }))
        : [],
      // One-time locations people approved for me in the last hour.
      snapshots: snapshots.map(r => ({
        requestId: r.id,
        name: memberName({ role: r.role, nickname: r.nickname, childDisplayName: r.child_display_name, firstName: r.first_name, lastName: r.last_name }, { withLastName: true }),
        latitude: Number(r.snapshot_lat),
        longitude: Number(r.snapshot_lng),
        accuracy: r.snapshot_accuracy != null ? Number(r.snapshot_accuracy) : null,
        at: r.snapshot_at,
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
    // The native Android app's background service has no web session; it
    // authenticates with a scoped device token instead (lib/device-token.ts).
    const deviceTokenHeader = request.headers.get("x-device-token")
    let deviceScope: { memberId: string; familyId: string } | null = null
    let user: Awaited<ReturnType<typeof getUserFromRequest>>["user"]
    let error: string | null
    if (deviceTokenHeader) {
      const info = await verifyDeviceToken(deviceTokenHeader)
      user = info ? await getUserWithFamily(info.userId) : null
      error = user ? null : "Invalid or revoked device token"
      if (info && user) deviceScope = { memberId: info.memberId, familyId: info.familyId }
    } else {
      ;({ user, error } = await getUserFromRequest(request))
    }

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = locationPingSchema.parse(body)
    if (deviceScope) {
      // A device token can only ever report for the member it was issued to.
      validatedData.memberId = deviceScope.memberId
      validatedData.familyId = deviceScope.familyId
    }

    // Guests have no location features in that family (or anywhere, if they
    // are only ever a guest).
    if (validatedData.familyId ? await isGuestInFamily(validatedData.familyId, user.id) : await isGuestOnly(user.id)) {
      return guestForbidden()
    }

    // Build query to find the correct location settings
    // If memberId/familyId provided, use those; otherwise fall back to first match
    let settings
    if (validatedData.memberId && validatedData.familyId) {
      settings = await sql`
        SELECT ls.mode, ls.share_with_family, fm.family_id, fm.id as member_id,
          fm.role, (f.owner_id = ${user.id}) AS is_owner
        FROM location_settings ls
        JOIN family_members fm ON ls.family_member_id = fm.id
        JOIN families f ON f.id = fm.family_id
        WHERE fm.id = ${validatedData.memberId}
          AND fm.family_id = ${validatedData.familyId}
          AND fm.user_id = ${user.id}
          AND fm.is_active = true
          AND fm.role <> 'GUEST'
        LIMIT 1
      `
    } else {
      settings = await sql`
        SELECT ls.mode, ls.share_with_family, fm.family_id, fm.id as member_id,
          fm.role, (f.owner_id = ${user.id}) AS is_owner
        FROM location_settings ls
        JOIN family_members fm ON ls.family_member_id = fm.id
        JOIN families f ON f.id = fm.family_id
        WHERE fm.user_id = ${user.id} AND fm.is_active = true AND fm.role <> 'GUEST'
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

    // Check if location sharing is enabled and mode allows sharing. With
    // sharing off or paused, a grown-up (PARENT/GUARDIAN/ADULT or the family
    // owner) may still send one fix on purpose ("Share now", once: true); the
    // saved setting is left as it is. A child's location stays off until a
    // parent turns it on, so children can't, and guests were refused above.
    const sharingOn = !!setting.share_with_family && setting.mode !== "OFF" && setting.mode !== "PAUSED"
    const oneTime = !sharingOn && validatedData.once === true &&
      (isAdultMemberRole(setting.role as string) || setting.is_owner === true)
    if (!sharingOn && !oneTime) {
      // Sharing is off, but a parent pinged this phone (no approval needed
      // for a child): the fix answers those pings as one-time snapshots for
      // the requesters only. Nothing is stored as a live location.
      const answered = await answerLocationRequests(user.id, {
        latitude: validatedData.latitude,
        longitude: validatedData.longitude,
        accuracy: validatedData.accuracy ?? null,
      })
      if (answered > 0) {
        return NextResponse.json({ success: true, data: { answeredRequests: answered, stored: false } })
      }
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
    // wild GPS/Wi-Fi outlier can't trigger a false "left" alert. Its accuracy
    // decides whether it can confirm; its battery level makes the low-battery
    // alert fire once per drop (it was never selected, so the alert repeated
    // on every ping at 15% or below).
    const prevPings = await sql`
      SELECT id, latitude, longitude, accuracy, battery_level, timestamp FROM location_pings
      WHERE user_id = ${user.id}
      ORDER BY timestamp DESC
      LIMIT 1
    `
    const prevPing: GeofenceFix | null = prevPings[0]
      ? {
          latitude: Number(prevPings[0].latitude),
          longitude: Number(prevPings[0].longitude),
          accuracy: prevPings[0].accuracy != null ? Number(prevPings[0].accuracy) : null,
          timeMs: new Date(prevPings[0].timestamp).getTime(),
        }
      : null
    const prevBattery = prevPings[0]?.battery_level != null ? Number(prevPings[0].battery_level) : null

    // Fixes queued while the phone had no signal: store them (oldest first,
    // skipping duplicates and anything absurdly old/future) so the history
    // trail has no gaps. Newly stored ones are run past the places below,
    // before the newest fix, so a delayed arrival still counts.
    // A one-time share is a single fix: no offline backlog comes with it.
    const nowMs = Date.now()
    const queued = (oneTime ? [] : validatedData.pings ?? [])
      .filter((q) => {
        const t = q.timestamp ? Date.parse(q.timestamp) : NaN
        return Number.isFinite(t) && t > nowMs - 7 * 86400_000 && t < nowMs + 300_000
      })
      .sort((a, b) => Date.parse(a.timestamp as string) - Date.parse(b.timestamp as string))
    const queuedFixes: GeofenceFix[] = []
    for (const q of queued) {
      const inserted = await sql`
        INSERT INTO location_pings (
          id, user_id, latitude, longitude, accuracy, altitude, speed, heading, battery_level, timestamp
        )
        SELECT ${`ping_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`}, ${user.id},
          ${q.latitude}, ${q.longitude}, ${q.accuracy ?? null}, ${q.altitude ?? null},
          ${q.speed ?? null}, ${q.heading ?? null}, ${q.batteryLevel ?? null}, ${q.timestamp}
        WHERE NOT EXISTS (
          SELECT 1 FROM location_pings WHERE user_id = ${user.id} AND timestamp = ${q.timestamp}
        )
        RETURNING id
      `
      // A resent backlog (the reply to an earlier delivery was lost) is
      // already stored and was already judged: only new fixes count.
      if (inserted.length > 0) {
        queuedFixes.push({
          latitude: q.latitude,
          longitude: q.longitude,
          accuracy: q.accuracy,
          timeMs: Date.parse(q.timestamp as string),
          queued: true,
        })
      }
    }

    // A phone with a wrong clock must not write a future-dated "latest" fix
    // (it would stay on the map and block departure/stale checks): clamp
    // anything more than 5 minutes ahead to now, like queued fixes above.
    const sentMs = validatedData.timestamp ? Date.parse(validatedData.timestamp) : NaN
    const pingTimestamp = Number.isFinite(sentMs) && sentMs <= Date.now() + 300_000
      ? (validatedData.timestamp as string)
      : new Date().toISOString()
    // Oldest first, the newest fix last.
    const geofenceFixes: GeofenceFix[] = [
      ...queuedFixes,
      {
        latitude: validatedData.latitude,
        longitude: validatedData.longitude,
        accuracy: validatedData.accuracy,
        timeMs: Date.parse(pingTimestamp),
      },
    ]

    // Geofences are evaluated on every report, before storing it: whether this
    // report changed an arrival/departure decides below whether it may be
    // merged into the previous row.
    const moved = prevPing
      ? distanceMeters(prevPing.latitude, prevPing.longitude, validatedData.latitude, validatedData.longitude)
      : null
    let suggestedIntervalSec: number | null = null
    let geofenceChanged = false
    // The places judged here, for the Android app's precise-location boost.
    const placeRows: Record<string, unknown>[] = []
    // Not for a one-time share while sharing is off here: the last arrival/
    // departure state may be days old, so a single fix would fire a late
    // "arrived"/"left" alert (with no recent fix to confirm a departure).
    if (subscription.features.geofencing && !oneTime) {
      const geo = await checkGeofences(
        user.id,
        setting.family_id,
        geofenceFixes,
        prevPing,
        alertPlaceLimit(subscription.tier)
      )
      geofenceChanged = geo.recorded > 0
      placeRows.push(...geo.places)
      // Only report faster near a boundary while actually moving; a phone
      // standing still (e.g. at home) keeps its normal interval.
      suggestedIntervalSec = suggestedIntervalForGaps(geo.gaps, moved)
    }

    // The same person's other families (e.g. a child in two households):
    // the ping is visible there too, so their places' arrival/departure
    // alerts must run as well, wherever sharing is on and the plan has them.
    const otherFamilies = await sql`
      SELECT fm.family_id FROM family_members fm
      JOIN location_settings ls ON ls.family_member_id = fm.id
      WHERE fm.user_id = ${user.id} AND fm.is_active = true
        AND fm.family_id <> ${setting.family_id}
        AND ls.mode = 'ACTIVE' AND ls.share_with_family = true
    `
    for (const other of otherFamilies) {
      const otherSub = await checkFamilySubscription(other.family_id as string)
      if (!otherSub.features.geofencing) continue
      const geo = await checkGeofences(
        user.id,
        other.family_id as string,
        geofenceFixes,
        prevPing,
        alertPlaceLimit(otherSub.tier)
      )
      if (geo.recorded > 0) geofenceChanged = true
      placeRows.push(...geo.places)
      const hint = suggestedIntervalForGaps(geo.gaps, moved)
      if (hint != null && (suggestedIntervalSec == null || hint < suggestedIntervalSec)) suggestedIntervalSec = hint
    }

    // A still phone repeating the same spot: move the previous row forward
    // instead of adding one (lib/location-dedupe.ts). Last-seen stays fresh;
    // a new row is still written every few minutes, after real movement, or
    // when a geofence state changed.
    const merge = !oneTime && shouldMergeWithPrevious({
      prev: prevPings[0]
        ? { id: prevPings[0].id as string, latitude: Number(prevPings[0].latitude), longitude: Number(prevPings[0].longitude) }
        : null,
      next: { latitude: validatedData.latitude, longitude: validatedData.longitude },
      distanceM: moved,
      nowMs: Date.now(),
      geofenceChanged,
      hasQueued: queued.length > 0,
    })
    let pingId: string
    if (merge) {
      pingId = prevPings[0].id as string
      await sql`
        UPDATE location_pings
        SET timestamp = ${pingTimestamp}, battery_level = COALESCE(${validatedData.batteryLevel ?? null}, battery_level)
        WHERE id = ${pingId}
      `
    } else {
      // Store location ping - use text-based ID to match column type. A
      // one-time share always gets its own, marked row (lib/location-dedupe.ts).
      pingId = oneTime
        ? oneTimePingId(Date.now(), setting.member_id as string)
        : `ping_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
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
          ${validatedData.accuracy ?? null},
          ${validatedData.altitude ?? null},
          ${validatedData.speed ?? null},
          ${validatedData.heading ?? null},
          ${validatedData.batteryLevel ?? null},
          ${pingTimestamp}
        )
      `

      // Free tier gets live location only, not history: keep just the latest
      // ping. Pings belong to the person, not a family, so this only applies
      // when none of their families has a paid plan (a child in a Free and a
      // Premium family keeps the Premium family's history).
      const inPaidFamily = subscription.tier === "FREE" && (await sql`
        SELECT 1 FROM family_members fm
        JOIN subscriptions s ON s.family_id = fm.family_id
        WHERE fm.user_id = ${user.id} AND fm.is_active = true
          AND s.tier <> 'FREE' AND s.status IN ('ACTIVE', 'TRIALING')
        LIMIT 1
      `).length > 0
      if (subscription.tier === "FREE" && !inPaidFamily && !(await isUnderLegalHold(user.id))) {
        await sql`DELETE FROM location_pings WHERE user_id = ${user.id} AND id != ${pingId}`
      }
    }

    // A fresh fix answers any "request location now" a parent made.
    try {
      await fulfillLocationRequests(user.id)
    } catch (err) {
      console.error("fulfillLocationRequests failed (non-fatal):", err)
    }

    // Low battery heads-up for parents, once per drop below 15%.
    const battery = validatedData.batteryLevel
    if (battery != null && battery <= 15 && (prevBattery == null || prevBattery > 15)) {
      try {
        // Every family that can see this person's location hears about it
        // (not one they only shared with once: nothing there stops updating).
        const alertFamilies = [...(oneTime ? [] : [setting.family_id as string]), ...otherFamilies.map((o) => o.family_id as string)]
        for (const familyId of alertFamilies) {
          const who = await nameInFamily(familyId, user.id, "A family member")
          await alertFamilyAdults(familyId, user.id, {
            title: `${who}'s battery is low`,
            body: `${who}'s phone is at ${battery}%. Their location may stop updating soon.`,
            data: { userId: user.id, subType: "LOW_BATTERY", batteryLevel: battery },
            // A grown-up's: only those they approved to see them.
            onlyUserIds: await locationAudienceUserIds(familyId, user.id),
          })
        }
      } catch (err) {
        console.error("Low battery alert failed (non-fatal):", err)
      }
    }

    // Keep paid-plan history within the plan's window. Runs on ~2% of pings
    // so it doesn't add a write to every ping.
    if (subscription.tier !== "FREE" && Math.random() < 0.02 && !(await isUnderLegalHold(user.id))) {
      await sql`
        DELETE FROM location_pings
        WHERE user_id = ${user.id}
          AND timestamp < NOW() - make_interval(days => ${subscription.features.locationTrailDays})
      `
    }

    return NextResponse.json({
      success: true,
      data: { pingId, suggestedIntervalSec, queuedAccepted: queued.length, places: toBoostPlaces(placeRows) },
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
  /** Oldest first: newly stored queued fixes, then the newest fix. */
  fixes: GeofenceFix[],
  prevPing: GeofenceFix | null,
  /** Places the plan allows alerts on (null = all): the family's oldest ones. */
  alertLimit: number | null = null
): Promise<{ gaps: number[]; recorded: number; places: Record<string, unknown>[] }> {
  const places = await geofencePlacesFor(userId, familyId, alertLimit)
  if (places.length === 0) return { gaps: [], recorded: 0, places }

  // Last arrival/departure state per place for this user, in one query.
  // Events from before a place was turned on/off, moved or resized don't count.
  const lastRows = await sql`
    SELECT DISTINCT ON (ge.saved_place_id) ge.saved_place_id, ge.event_type, ge.timestamp
    FROM geofence_events ge
    JOIN saved_places sp ON sp.id = ge.saved_place_id
    WHERE ge.user_id = ${userId}
      AND ge.timestamp > COALESCE(sp.geofence_state_reset_at, '-infinity'::timestamptz)
    ORDER BY ge.saved_place_id, ge.timestamp DESC
  `
  const lastByPlace = new Map<string, { type: string; atMs: number }>()
  for (const r of lastRows) lastByPlace.set(r.saved_place_id, { type: r.event_type, atMs: new Date(r.timestamp).getTime() })

  // Hysteresis, accuracy gating and departure confirmation live in
  // lib/geofence.ts (unit tested). Each fix carries the state to the next.
  const nowMs = Date.now()
  const { transitions, gaps } = planGeofenceTransitions(
    places.map((p) => ({
      id: p.id as string,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      radius: Number(p.radius),
      wasInside: lastByPlace.get(p.id)?.type === "ARRIVAL",
      lastEventMs: lastByPlace.get(p.id)?.atMs ?? null,
    })),
    fixes,
    prevPing,
    nowMs
  )
  const byId = new Map(places.map((p) => [p.id as string, p]))
  let recordedCount = 0

  for (const t of transitions) {
    const place = byId.get(t.placeId)!
    // State is always recorded so arrival/departure tracking stays correct
    // even when only one of the two alerts is enabled (previously a place
    // with arrival alerts off could never report a departure). The insert is
    // skipped if the same event was just written, which stops two
    // overlapping pings from double-alerting.
    const recorded = await recordGeofenceEvent(userId, place.id, t.transition, t.fix.latitude, t.fix.longitude, t.atMs)
    if (!recorded) continue
    recordedCount++

    // A backlog older than the time window only updates the state: an alert
    // hours after the fact would read as if it just happened.
    const fresh = t.fix.timeMs >= nowMs - GEOFENCE_FIX_MAX_AGE_MS
    const wantsAlert = t.transition === "ARRIVAL" ? place.alert_on_arrival : place.alert_on_departure
    if (wantsAlert && fresh) {
      await createGeofenceNotification(userId, familyId, place.name, t.transition, place.notify_channels)
    }
  }

  return { gaps, recorded: recordedCount, places }
}

async function recordGeofenceEvent(
  userId: string,
  placeId: string,
  eventType: "ARRIVAL" | "DEPARTURE",
  latitude: number,
  longitude: number,
  /** When it happened (geofenceEventTimeMs): the fix's own time, or now. */
  atMs: number
): Promise<boolean> {
  const eventId = `gfe_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  const at = new Date(atMs).toISOString()
  const rows = await sql`
    INSERT INTO geofence_events (id, user_id, saved_place_id, event_type, latitude, longitude, timestamp)
    SELECT ${eventId}, ${userId}, ${placeId}, ${eventType}, ${latitude}, ${longitude}, ${at}::timestamptz
    WHERE NOT EXISTS (
      SELECT 1 FROM geofence_events
      WHERE user_id = ${userId} AND saved_place_id = ${placeId}
        AND event_type = ${eventType}
        AND timestamp > ${at}::timestamptz - INTERVAL '45 seconds'
        AND timestamp < ${at}::timestamptz + INTERVAL '45 seconds'
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
  // Their name in this family
  const userName = await nameInFamily(familyId, userId)

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
  // A grown-up's arrivals only reach the grown-ups they approved to see them.
  const audience = await locationAudienceUserIds(familyId, userId)
  const allowedRecipients = audience ? recipients.filter((r) => audience.includes(r.user_id)) : recipients

  const actionVerb = eventType === "ARRIVAL" ? "arrived" : "left"
  const title = eventType === "ARRIVAL" ? `${userName} arrived at ${placeName}` : `${userName} left ${placeName}`
  const body =
    eventType === "ARRIVAL"
      ? "Arrival alert"
      : "Departure alert"
  const timeStr = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })

  for (const recipient of allowedRecipients) {
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
    if (wantsSms && smsEnabled && recipient.phone && isSmsConfigured()) {
      try {
        const smsBody =
          eventType === "ARRIVAL"
            ? SMS_TEMPLATES.GEOFENCE_ARRIVAL(userName, placeName)
            : SMS_TEMPLATES.GEOFENCE_DEPARTURE(userName, placeName)
        // Geofence alerts count against the family's monthly SMS quota.
        const result = await sendSMSMetered({ familyId, to: recipient.phone, body: smsBody })
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
