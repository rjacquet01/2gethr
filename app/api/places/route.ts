import { NextRequest, NextResponse } from "next/server"
import { ensurePlaceNotifyChannelsColumn } from "@/lib/place-schema"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { z } from "zod"

const createPlaceSchema = z.object({
  familyId: z.string().uuid("Invalid family ID"),
  name: z.string().min(1, "Name is required").max(100),
  address: z.string().max(500).optional().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius: z.number().int().min(50).max(5000).default(100), // meters
  geofenceEnabled: z.boolean().default(false),
  alertOnArrival: z.boolean().default(true),
  alertOnDeparture: z.boolean().default(true),
  icon: z.string().max(50).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#3B82F6"),
  // Which channels a geofence arrival/departure alert for this place uses
  // (in_app, push, email, sms) - mirrors notify_channels on tasks/events/
  // reminders. Omitted or empty falls back to the recipient's own
  // notification settings, same as every place created before this existed.
  notifyChannels: z.array(z.enum(["in_app", "push", "email", "sms"])).optional(),
})

// Get saved places for a family
export async function GET(request: NextRequest) {
  await ensurePlaceNotifyChannelsColumn()
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

    // Verify membership
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

    const places = await sql`
      SELECT * FROM saved_places 
      WHERE family_id = ${familyId}
      ORDER BY name ASC
    `

    return NextResponse.json({
      success: true,
      data: places.map(p => ({
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
      })),
    })
  } catch (error) {
    console.error("Get places error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get saved places" },
      { status: 500 }
    )
  }
}

// Create a new saved place
export async function POST(request: NextRequest) {
  await ensurePlaceNotifyChannelsColumn()
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = createPlaceSchema.parse(body)

    // Verify user is a PARENT
    const membership = await sql`
      SELECT role FROM family_members 
      WHERE family_id = ${validatedData.familyId} AND user_id = ${user.id} AND is_active = true
    `

    if (membership.length === 0 || !["PARENT", "GUARDIAN", "ADMIN"].includes(membership[0].role)) {
      return NextResponse.json(
        { success: false, error: "Only parents or guardians can create saved places" },
        { status: 403 }
      )
    }

    // Check subscription limits
    const subscription = await checkFamilySubscription(validatedData.familyId)
    const placeCount = await sql`
      SELECT COUNT(*) as count FROM saved_places WHERE family_id = ${validatedData.familyId}
    `

    if (Number(placeCount[0].count) >= subscription.features.maxSavedPlaces) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Family has reached its saved places limit (${subscription.features.maxSavedPlaces}). Upgrade to add more.` 
        },
        { status: 400 }
      )
    }

    // Check if geofencing is allowed
    if (validatedData.geofenceEnabled && !subscription.features.geofencing) {
      return NextResponse.json(
        { success: false, error: "Geofencing requires a Premium subscription" },
        { status: 403 }
      )
    }

    const placeId = crypto.randomUUID()
    const normalizedNotifyChannels =
      validatedData.notifyChannels && validatedData.notifyChannels.length > 0
        ? validatedData.notifyChannels
        : null
    await sql`
      INSERT INTO saved_places (
        id, family_id, name, address, latitude, longitude, radius,
        geofence_enabled, alert_on_arrival, alert_on_departure,
        icon, color, notify_channels, created_at, updated_at
      )
      VALUES (
        ${placeId},
        ${validatedData.familyId},
        ${validatedData.name},
        ${validatedData.address || null},
        ${validatedData.latitude},
        ${validatedData.longitude},
        ${validatedData.radius},
        ${validatedData.geofenceEnabled},
        ${validatedData.alertOnArrival},
        ${validatedData.alertOnDeparture},
        ${validatedData.icon || null},
        ${validatedData.color},
        ${normalizedNotifyChannels},
        NOW(), NOW()
      )
    `

    // Audit log
    await logAuditEvent(user.id, "CREATE", "saved_place", placeId, {
      newValue: { name: validatedData.name, familyId: validatedData.familyId },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      data: {
        id: placeId,
        ...validatedData,
      },
      message: "Saved place created successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Create place error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create saved place" },
      { status: 500 }
    )
  }
}
