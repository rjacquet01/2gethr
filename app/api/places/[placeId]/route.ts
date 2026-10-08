import { NextRequest, NextResponse } from "next/server"
import { ensurePlaceNotifyChannelsColumn } from "@/lib/place-schema"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { z } from "zod"

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
      SELECT sp.*, f.id as family_id
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

    const p = places[0]
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

    if (!["PARENT", "GUARDIAN", "ADMIN"].includes(places[0].role)) {
      return NextResponse.json(
        { success: false, error: "Only parents or guardians can update saved places" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = updatePlaceSchema.parse(body)

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

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      )
    }

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
        updated_at = NOW()
      WHERE id = ${placeId}
    `

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "saved_place", placeId, {
      oldValue: { name: places[0].name },
      newValue: validatedData,
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

    // Check if place exists and user has permission
    const places = await sql`
      SELECT sp.name, sp.family_id, fm.role
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

    if (!["PARENT", "GUARDIAN", "ADMIN"].includes(places[0].role)) {
      return NextResponse.json(
        { success: false, error: "Only parents or guardians can delete saved places" },
        { status: 403 }
      )
    }

    // Delete the place
    await sql`DELETE FROM saved_places WHERE id = ${placeId}`

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
