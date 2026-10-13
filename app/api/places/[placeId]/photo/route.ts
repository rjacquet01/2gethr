import { NextRequest, NextResponse } from "next/server"
import { put, del } from "@vercel/blob"
import sharp from "sharp"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { ensurePlaceNotifyChannelsColumn } from "@/lib/place-schema"

export const runtime = "nodejs"

const MAX_FILE_SIZE = 4 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

async function loadEditablePlace(request: NextRequest, placeId: string) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) {
    return { response: NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 }) }
  }
  const rows = await sql`
    SELECT sp.id, sp.family_id, sp.photo_path, sp.photo_url, sp.created_by_id, fm.role
    FROM saved_places sp
    JOIN family_members fm ON sp.family_id = fm.family_id
    WHERE sp.id = ${placeId} AND fm.user_id = ${user.id} AND fm.is_active = true
  `
  if (rows.length === 0) {
    return { response: NextResponse.json({ success: false, error: "Place not found" }, { status: 404 }) }
  }
  const isCreator = rows[0].created_by_id != null && String(rows[0].created_by_id) === String(user.id)
  if (!["PARENT", "GUARDIAN", "ADMIN"].includes(rows[0].role) && !isCreator) {
    return {
      response: NextResponse.json(
        { success: false, error: "You can only change photos on places you added" },
        { status: 403 }
      ),
    }
  }
  return { user, place: rows[0] }
}

// Upload (or replace) the photo for a saved place
export async function POST(request: NextRequest, { params }: { params: Promise<{ placeId: string }> }) {
  try {
    await ensurePlaceNotifyChannelsColumn()
    const { placeId } = await params
    const found = await loadEditablePlace(request, placeId)
    if ("response" in found) return found.response
    const { user, place } = found

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File too large. Maximum size is 4MB" }, { status: 400 })
    }

    // Normalise: fix phone rotation, shrink, and re-encode (also strips location metadata)
    const input = Buffer.from(await file.arrayBuffer())
    const output = await sharp(input)
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    const blob = await put(`place-photos/${place.family_id}/${placeId}-${Date.now()}.jpg`, output, {
      access: "private",
      contentType: "image/jpeg",
    })

    await sql`
      UPDATE saved_places
      SET photo_path = ${blob.pathname}, photo_url = ${blob.url}, updated_at = NOW()
      WHERE id = ${placeId}
    `

    if (place.photo_url) {
      try {
        await del(place.photo_url)
      } catch (e) {
        console.warn("Failed to delete old place photo:", e)
      }
    }

    await logAuditEvent(user.id, "UPDATE", "saved_place_photo", placeId, {
      newValue: { photoPath: blob.pathname },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({ success: true, data: { pathname: blob.pathname } })
  } catch (error) {
    console.error("Upload place photo error:", error)
    return NextResponse.json({ success: false, error: "Failed to upload place photo" }, { status: 500 })
  }
}

// Remove the photo (the card goes back to its icon)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ placeId: string }> }) {
  try {
    await ensurePlaceNotifyChannelsColumn()
    const { placeId } = await params
    const found = await loadEditablePlace(request, placeId)
    if ("response" in found) return found.response
    const { user, place } = found

    if (place.photo_url) {
      try {
        await del(place.photo_url)
      } catch (e) {
        console.warn("Failed to delete place photo from storage:", e)
      }
    }
    await sql`UPDATE saved_places SET photo_path = NULL, photo_url = NULL, updated_at = NOW() WHERE id = ${placeId}`

    await logAuditEvent(user.id, "DELETE", "saved_place_photo", placeId, {
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete place photo error:", error)
    return NextResponse.json({ success: false, error: "Failed to delete place photo" }, { status: 500 })
  }
}
