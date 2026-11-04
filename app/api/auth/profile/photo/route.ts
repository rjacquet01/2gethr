import { NextRequest, NextResponse } from "next/server"
import { put, del } from "@vercel/blob"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { notifyAccountChange, requestIp } from "@/lib/admin-account-alerts"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      )
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "File too large. Maximum size is 5MB" },
        { status: 400 }
      )
    }

    // Get current profile photo path to delete later
    const currentUser = await sql`
      SELECT profile_photo_url FROM users WHERE id = ${user.id}
    `
    const oldPhotoUrl = currentUser[0]?.profile_photo_url

    // Upload to Vercel Blob (private storage)
    const fileName = `profile-photos/${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`
    
    const blob = await put(fileName, file, {
      access: "private",
    })

    // Update user profile with new photo path
    await sql`
      UPDATE users 
      SET 
        profile_photo_path = ${blob.pathname},
        profile_photo_url = ${blob.url},
        updated_at = NOW()
      WHERE id = ${user.id}
    `

    // Delete old photo if exists
    if (oldPhotoUrl) {
      try {
        await del(oldPhotoUrl)
      } catch (deleteError) {
        console.warn("Failed to delete old profile photo:", deleteError)
      }
    }

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "profile_photo", user.id, {
      newValue: { photoPath: blob.pathname },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    await notifyAccountChange({
      actor: user.email,
      actorType: "user",
      accountEmail: user.email,
      change: "Profile photo updated",
      ipAddress: requestIp(request),
    })

    return NextResponse.json({
      success: true,
      data: {
        pathname: blob.pathname,
      },
      message: "Profile photo uploaded successfully",
    })
  } catch (error) {
    console.error("Upload profile photo error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to upload profile photo" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Get current profile photo
    const currentUser = await sql`
      SELECT profile_photo_url FROM users WHERE id = ${user.id}
    `

    const photoUrl = currentUser[0]?.profile_photo_url

    if (!photoUrl) {
      return NextResponse.json(
        { success: false, error: "No profile photo to delete" },
        { status: 404 }
      )
    }

    // Delete from Blob storage
    try {
      await del(photoUrl)
    } catch (deleteError) {
      console.warn("Failed to delete from blob storage:", deleteError)
    }

    // Update user profile
    await sql`
      UPDATE users 
      SET 
        profile_photo_path = NULL,
        profile_photo_url = NULL,
        updated_at = NOW()
      WHERE id = ${user.id}
    `

    // Audit log
    await logAuditEvent(user.id, "DELETE", "profile_photo", user.id, {
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    await notifyAccountChange({
      actor: user.email,
      actorType: "user",
      accountEmail: user.email,
      change: "Profile photo removed",
      ipAddress: requestIp(request),
    })

    return NextResponse.json({
      success: true,
      message: "Profile photo deleted successfully",
    })
  } catch (error) {
    console.error("Delete profile photo error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to delete profile photo" },
      { status: 500 }
    )
  }
}
