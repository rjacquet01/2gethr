import { NextRequest, NextResponse } from "next/server"
import { ensurePlaceNotifyChannelsColumn, getPlaceAssignees, setPlaceAssignees, validatePlaceAssignees } from "@/lib/place-schema"
import { sql } from "@/lib/db"
import { alertLimitError, alertPlaceLimit, alertPlacesInUse } from "@/lib/place-alerts"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { guestForbidden } from "@/lib/permissions"
import { z } from "zod"
import { del } from "@vercel/blob"

const updatePlaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().max(500).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius: z.number().int().min(50).max(5000).optional(),
  geofenceEnabled: z.boolean().optional(),
  alertOnArrival: z.boolean().optional(),
  alertOnDeparture: z.boolean().optional(),
  icon: z.string().max(50).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  notifyChannels: z.array(z.enum(["in_app", "push", "email", "sms"])).optional(),
  // Kids this place applies to (family_members ids, role CHILD). Empty =
  // everyone, omitted = unchanged. Only parents/guardians/adults may set it.
  assignedMemberIds: z.array(z.string().min(1).max(100)).max(50).optional(),
})

// Get a single place
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ placeId: string }> }
) {
  try {
    await ensurePlaceNotifyChannelsColumn()
    const { placeId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const places = await sql`
      SELECT sp.*, f.id as family_id, fm.role as member_role, fm.id as member_id
      FROM saved_places sp
      JOIN families f ON sp.family_id = f.id
      JOIN family_members fm ON f.id = fm.family_id
      WHERE sp.id = ${placeId} AND fm.user_id = ${user.id} AND fm.is_active = true
    `

    if (places.length === 0) {
      return NextResponse.json(
        { success: false, error: "Place not found" },
        { status: 404 }
      )
    }
    if (places[0].member_role === "GUEST") return guestForbidden()

    const p = places[0]
    const ids = (await getPlaceAssignees([p.id as string])).get(p.id as string) ?? []
    const viewerIsManager = ["PARENT", "GUARDIAN", "ADULT", "ADMIN"].includes(p.member_role)
    return NextResponse.json({
      success: true,
      data: {
        id: p.id,
        familyId: p.family_id,
        name: p.name,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        geofenceEnabled: p.geofence_enabled,
        alertOnArrival: p.alert_on_arrival,
        alertOnDeparture: p.alert_on_departure,
        icon: p.icon,
        color: p.color,
        notifyChannels: p.notify_channels,
        // Same rule as the list: only managers see which other kids
        assignedMemberIds: viewerIsManager ? ids : ids.filter((id) => id === p.member_id),
        isAssigned: ids.length > 0,
        photoPath: p.photo_path ?? null,
        createdAt: p.created_at,
      },
    })
  } catch (error) {
    console.error("Get place error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get place" },
      { status: 500 }
    )
  }
}

// Update a place
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ placeId: string }> }
) {
  try {
    await ensurePlaceNotifyChannelsColumn()
    const { placeId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Check if place exists and user has permission
    const places = await sql`
      SELECT sp.*, fm.role
      FROM saved_places sp
      JOIN family_members fm ON sp.family_id = fm.family_id
      WHERE sp.id = ${placeId} AND fm.user_id = ${user.id} AND fm.is_active = true
    `

    if (places.length === 0) {
      return NextResponse.json(
        { success: false, error: "Place not found" },
        { status: 404 }
      )
    }

    if (places[0].role === "GUEST") return guestForbidden()

    const isManager = ["PARENT", "GUARDIAN", "ADULT", "ADMIN"].includes(places[0].role)
    const isCreator = places[0].created_by_id != null && String(places[0].created_by_id) === String(user.id)
    if (!isManager && !isCreator) {
      return NextResponse.json(
        { success: false, error: "You can only edit places you added" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = updatePlaceSchema.parse(body)

    // Which kids a place applies to: parents/guardians/adults only
    let assignedMemberIds: string[] | undefined
    if (validatedData.assignedMemberIds !== undefined) {
      if (!isManager) {
        return NextResponse.json(
          { success: false, error: "Only a parent or guardian can assign places to kids" },
          { status: 403 }
        )
      }
      assignedMemberIds = [...new Set(validatedData.assignedMemberIds)]
      const invalid = await validatePlaceAssignees(places[0].family_id, assignedMemberIds)
      if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 })
    }
    delete validatedData.assignedMemberIds

    // Geofence alerts watch every family member, so only parents/guardians change them
    if (!isManager) {
      delete validatedData.geofenceEnabled
      delete validatedData.alertOnArrival
      delete validatedData.alertOnDeparture
      delete validatedData.notifyChannels
    }

    // Turning alerts on must fit the plan (Plus: 3 places, Premium: all).
    // A place that already has them on can be edited freely.
    if (validatedData.geofenceEnabled && places[0].geofence_enabled !== true) {
      const sub = await checkFamilySubscription(places[0].family_id)
      const why = alertLimitError(alertPlaceLimit(sub.tier), await alertPlacesInUse(places[0].family_id, placeId))
      if (why) return NextResponse.json({ success: false, error: why }, { status: 403 })
    }

    // Build update query dynamically
    const updates: string[] = []
    const values: (string | number | boolean | null)[] = []

    if (validatedData.name !== undefined) {
      updates.push("name")
      values.push(validatedData.name)
    }
    if (validatedData.address !== undefined) {
      updates.push("address")
      values.push(validatedData.address)
    }
    if (validatedData.latitude !== undefined) {
      updates.push("latitude")
      values.push(validatedData.latitude)
    }
    if (validatedData.longitude !== undefined) {
      updates.push("longitude")
      values.push(validatedData.longitude)
    }
    if (validatedData.radius !== undefined) {
      updates.push("radius")
      values.push(validatedData.radius)
    }
    if (validatedData.geofenceEnabled !== undefined) {
      updates.push("geofence_enabled")
      values.push(validatedData.geofenceEnabled)
    }
    if (validatedData.alertOnArrival !== undefined) {
      updates.push("alert_on_arrival")
      values.push(validatedData.alertOnArrival)
    }
    if (validatedData.alertOnDeparture !== undefined) {
      updates.push("alert_on_departure")
      values.push(validatedData.alertOnDeparture)
    }
    if (validatedData.icon !== undefined) {
      updates.push("icon")
      values.push(validatedData.icon)
    }
    if (validatedData.color !== undefined) {
      updates.push("color")
      values.push(validatedData.color)
    }
    if (validatedData.notifyChannels !== undefined) {
      updates.push("notify_channels")
      values.push(true)
    }

    if (updates.length === 0 && assignedMemberIds === undefined) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      )
    }

    // Turning alerts on/off, moving the pin or changing the radius starts
    // inside/outside tracking afresh: an old "arrived" (from before a summer
    // break, or at the old spot) must not swallow the next arrival or fire a
    // false "left".
    const cur = places[0]
    const changed = (v: number | undefined, old: unknown) => v !== undefined && Number(old) !== v
    const resetGeofenceState =
      (validatedData.geofenceEnabled !== undefined && validatedData.geofenceEnabled !== cur.geofence_enabled) ||
      changed(validatedData.latitude, cur.latitude) ||
      changed(validatedData.longitude, cur.longitude) ||
      changed(validatedData.radius, cur.radius)

    // Execute update
    const normalizedNotifyChannels =
      validatedData.notifyChannels !== undefined
        ? validatedData.notifyChannels.length > 0
          ? validatedData.notifyChannels
          : null
        : undefined
    await sql`
      UPDATE saved_places SET
        name = COALESCE(${validatedData.name}, name),
        address = COALESCE(${validatedData.address}, address),
        latitude = COALESCE(${validatedData.latitude}, latitude),
        longitude = COALESCE(${validatedData.longitude}, longitude),
        radius = COALESCE(${validatedData.radius}, radius),
        geofence_enabled = COALESCE(${validatedData.geofenceEnabled}, geofence_enabled),
        alert_on_arrival = COALESCE(${validatedData.alertOnArrival}, alert_on_arrival),
        alert_on_departure = COALESCE(${validatedData.alertOnDeparture}, alert_on_departure),
        icon = COALESCE(${validatedData.icon}, icon),
        color = COALESCE(${validatedData.color}, color),
        notify_channels = COALESCE(${normalizedNotifyChannels ?? null}, notify_channels),
        geofence_state_reset_at = CASE WHEN ${resetGeofenceState} THEN NOW() ELSE geofence_state_reset_at END,
        updated_at = NOW()
      WHERE id = ${placeId}
    `
    if (assignedMemberIds !== undefined) await setPlaceAssignees(placeId, assignedMemberIds)

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "saved_place", placeId, {
      oldValue: { name: places[0].name },
      newValue: assignedMemberIds !== undefined ? { ...validatedData, assignedMemberIds } : validatedData,
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Place updated successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Update place error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update place" },
      { status: 500 }
    )
  }
}

// Delete a place
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ placeId: string }> }
) {
  try {
    const { placeId } = await params
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    await ensurePlaceNotifyChannelsColumn()
    // Check if place exists and user has permission
    const places = await sql`
      SELECT sp.name, sp.family_id, sp.photo_url, sp.created_by_id, fm.role
      FROM saved_places sp
      JOIN family_members fm ON sp.family_id = fm.family_id
      WHERE sp.id = ${placeId} AND fm.user_id = ${user.id} AND fm.is_active = true
    `

    if (places.length === 0) {
      return NextResponse.json(
        { success: false, error: "Place not found" },
        { status: 404 }
      )
    }

    if (places[0].role === "GUEST") return guestForbidden()

    if (
      !["PARENT", "GUARDIAN", "ADULT", "ADMIN"].includes(places[0].role) &&
      !(places[0].created_by_id != null && String(places[0].created_by_id) === String(user.id))
    ) {
      return NextResponse.json(
        { success: false, error: "You can only delete places you added" },
        { status: 403 }
      )
    }

    // Delete the place
    await sql`DELETE FROM saved_places WHERE id = ${placeId}`
    if (places[0].photo_url) {
      try {
        await del(places[0].photo_url)
      } catch (e) {
        console.warn("Failed to delete place photo:", e)
      }
    }

    // Audit log
    await logAuditEvent(user.id, "DELETE", "saved_place", placeId, {
      oldValue: { name: places[0].name, familyId: places[0].family_id },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Place deleted successfully",
    })
  } catch (error) {
    console.error("Delete place error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to delete place" },
      { status: 500 }
    )
  }
}
