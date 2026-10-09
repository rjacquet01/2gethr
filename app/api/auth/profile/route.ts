import { NextRequest, NextResponse } from "next/server"
import { isValidTimeZone } from "@/lib/recurrence"
import { sql } from "@/lib/db"
import { getUserFromRequest, hashPassword, logAuditEvent } from "@/lib/auth"
import { z } from "zod"

const updateProfileSchema = z.object({
  // Empty strings are allowed here (no .min(1)) even though the UI shows
  // "required"-looking name fields. The profile form always submits
  // firstName/lastName alongside whatever field the user actually meant to
  // change (e.g. phone), so if a user's name happens to be blank, every
  // save - not just name edits - was getting rejected with a 400 before a
  // name was ever entered. Blank names are harmless to persist.
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(20).optional().nullable(),
  timezone: z.string().refine((tz) => isValidTimeZone(tz), { message: "Invalid timezone" }).optional(),
  dateOfBirth: z.string().optional().nullable(),
})

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Get full profile data
    const profiles = await sql`
      SELECT 
        id, email, first_name, last_name, phone,
        profile_photo_url, profile_photo_path, timezone,
        date_of_birth, email_verified, created_at, updated_at
      FROM users 
      WHERE id = ${user.id}
    `

    if (profiles.length === 0) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      )
    }

    const profile = profiles[0]

    return NextResponse.json({
      success: true,
      data: {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        phone: profile.phone,
        profilePhotoUrl: profile.profile_photo_url,
        profilePhotoPath: profile.profile_photo_path,
        timezone: profile.timezone,
        dateOfBirth: profile.date_of_birth,
        emailVerified: profile.email_verified,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    })
  } catch (error) {
    console.error("Get profile error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get profile" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = updateProfileSchema.parse(body)

    // Build update query dynamically
    const updates: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (validatedData.firstName !== undefined) {
      updates.push(`first_name = $${paramIndex++}`)
      values.push(validatedData.firstName)
    }
    if (validatedData.lastName !== undefined) {
      updates.push(`last_name = $${paramIndex++}`)
      values.push(validatedData.lastName)
    }
    if (validatedData.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`)
      values.push(validatedData.phone)
    }
    if (validatedData.timezone !== undefined) {
      updates.push(`timezone = $${paramIndex++}`)
      values.push(validatedData.timezone)
    }
    if (validatedData.dateOfBirth !== undefined) {
      updates.push(`date_of_birth = $${paramIndex++}`)
      values.push(validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth).toISOString() : null)
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      )
    }

    // Update with individual fields for Neon tagged template
    await sql`
      UPDATE users 
      SET 
        first_name = COALESCE(${validatedData.firstName}, first_name),
        last_name = COALESCE(${validatedData.lastName}, last_name),
        phone = CASE WHEN ${validatedData.phone !== undefined} THEN ${validatedData.phone} ELSE phone END,
        timezone = COALESCE(${validatedData.timezone}, timezone),
        date_of_birth = CASE WHEN ${validatedData.dateOfBirth !== undefined} THEN ${validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth).toISOString() : null}::timestamp ELSE date_of_birth END,
        updated_at = NOW()
      WHERE id = ${user.id}
    `

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "user", user.id, {
      newValue: validatedData as Record<string, unknown>,
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Update profile error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update profile" },
      { status: 500 }
    )
  }
}

// Change password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain uppercase, lowercase, and number"
    ),
})

export async function PUT(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { currentPassword, newPassword } = changePasswordSchema.parse(body)

    // Get current password hash
    const users = await sql`
      SELECT password_hash FROM users WHERE id = ${user.id}
    `

    if (users.length === 0) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      )
    }

    // Verify current password
    const bcrypt = await import("bcryptjs")
    const isValid = await bcrypt.compare(currentPassword, users[0].password_hash)

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Current password is incorrect" },
        { status: 401 }
      )
    }

    // Hash new password and update
    const newPasswordHash = await hashPassword(newPassword)

    await sql`
      UPDATE users 
      SET password_hash = ${newPasswordHash}, updated_at = NOW()
      WHERE id = ${user.id}
    `

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "user_password", user.id, {
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Password changed successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Change password error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to change password" },
      { status: 500 }
    )
  }
}
