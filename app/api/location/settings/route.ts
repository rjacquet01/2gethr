import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription, logAuditEvent } from "@/lib/auth"
import { z } from "zod"
import { notifyChildStoppedSharing } from "@/lib/family-alerts"

const updateSettingsSchema = z.object({
  memberId: z.string().min(1, "Member ID is required"),
  mode: z.enum(["OFF", "ACTIVE", "PAUSED"]).optional(),
  shareWithFamily: z.boolean().optional(),
  updateIntervalSec: z.number().int().min(60).max(3600).optional(),
})

// Get location settings for a member
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const memberId = request.nextUrl.searchParams.get("memberId")

    if (!memberId) {
      // Get settings for current user - also return member info even if no settings exist
      const memberSettings = await sql`
        SELECT 
          fm.id as member_id, fm.family_id, fm.user_id,
          ls.id as settings_id, ls.mode, ls.share_with_family, 
          ls.update_interval_sec, ls.last_mode_change
        FROM family_members fm
        LEFT JOIN location_settings ls ON ls.family_member_id = fm.id
        WHERE fm.user_id = ${user.id} AND fm.is_active = true
      `

      if (memberSettings.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          message: "No family membership found",
        })
      }

      // Auto-create settings for members that don't have them
      const settings = []
      for (const s of memberSettings) {
        if (!s.settings_id) {
          // Create default settings
          const settingsId = `loc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
          await sql`
            INSERT INTO location_settings (
              id, family_member_id, mode, share_with_family, 
              update_interval_sec, created_at, updated_at
            )
            VALUES (
              ${settingsId},
              ${s.member_id},
              'OFF',
              false,
              300,
              NOW(), NOW()
            )
          `
          settings.push({
            id: settingsId,
            memberId: s.member_id,
            familyId: s.family_id,
            mode: 'OFF',
            shareWithFamily: false,
            updateIntervalSec: 300,
            lastModeChange: null,
          })
        } else {
          settings.push({
            id: s.settings_id,
            memberId: s.member_id,
            familyId: s.family_id,
            mode: s.mode || 'OFF',
            shareWithFamily: s.share_with_family || false,
            updateIntervalSec: s.update_interval_sec || 300,
            lastModeChange: s.last_mode_change,
          })
        }
      }

      return NextResponse.json({
        success: true,
        data: settings,
      })
    }

    // Get settings for specific member (must be parent)
    const membership = await sql`
      SELECT fm.role, fm.family_id, target.user_id as target_user_id
      FROM family_members fm
      JOIN family_members target ON fm.family_id = target.family_id AND target.id = ${memberId}
      WHERE fm.user_id = ${user.id} AND fm.is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member not found or access denied" },
        { status: 404 }
      )
    }

    // Parents/guardians/admins can view others' settings, or user can view their own
    const isOwnSettings = membership[0].target_user_id === user.id
    const canManageOthers = ["PARENT", "GUARDIAN", "ADMIN"].includes(membership[0].role)
    if (!isOwnSettings && !canManageOthers) {
      return NextResponse.json(
        { success: false, error: "Only parents or guardians can view other members' location settings" },
        { status: 403 }
      )
    }

    const settings = await sql`
      SELECT * FROM location_settings WHERE family_member_id = ${memberId}
    `

    if (settings.length === 0) {
      return NextResponse.json({
        success: true,
        data: null,
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        id: settings[0].id,
        memberId: settings[0].family_member_id,
        mode: settings[0].mode,
        shareWithFamily: settings[0].share_with_family,
        updateIntervalSec: settings[0].update_interval_sec,
        lastModeChange: settings[0].last_mode_change,
      },
    })
  } catch (error) {
    console.error("Get location settings error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get location settings" },
      { status: 500 }
    )
  }
}

// Update location settings
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
    const validatedData = updateSettingsSchema.parse(body)

    // Get member and verify access
    const membership = await sql`
      SELECT fm.role, fm.family_id, target.user_id as target_user_id, target.role as target_role
      FROM family_members fm
      JOIN family_members target ON fm.family_id = target.family_id AND target.id = ${validatedData.memberId}
      WHERE fm.user_id = ${user.id} AND fm.is_active = true
    `

    if (membership.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member not found or access denied" },
        { status: 404 }
      )
    }

    const isOwnSettings = membership[0].target_user_id === user.id
    const isParentOrGuardian = ["PARENT", "GUARDIAN", "ADMIN"].includes(membership[0].role)
    const targetIsChild = membership[0].target_role === "CHILD"

    // Permission check: user can update own settings, parent/guardian/admin can update a child's settings
    if (!isOwnSettings && !(isParentOrGuardian && targetIsChild)) {
      return NextResponse.json(
        { success: false, error: "You can only update your own settings or your children's settings" },
        { status: 403 }
      )
    }

    // Check subscription
    const subscription = await checkFamilySubscription(membership[0].family_id)
    if (validatedData.shareWithFamily && !subscription.features.locationSharing) {
      return NextResponse.json(
        { success: false, error: "Location sharing requires the Premium plan", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      )
    }

    // Check if settings exist
    const existing = await sql`
      SELECT id, mode, share_with_family FROM location_settings WHERE family_member_id = ${validatedData.memberId}
    `
    const wasSharing = existing.length > 0 && existing[0].mode === "ACTIVE" && existing[0].share_with_family === true

    if (existing.length === 0) {
      // Create settings - generate a text-based ID to match the column type
      const settingsId = `loc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      await sql`
        INSERT INTO location_settings (
          id, family_member_id, mode, share_with_family, 
          update_interval_sec, last_mode_change, created_at, updated_at
        )
        VALUES (
          ${settingsId},
          ${validatedData.memberId},
          ${validatedData.mode || 'OFF'},
          ${validatedData.shareWithFamily ?? false},
          ${validatedData.updateIntervalSec || 300},
          NOW(), NOW(), NOW()
        )
      `
    } else {
      // Update settings
      await sql`
        UPDATE location_settings SET
          mode = COALESCE(${validatedData.mode}, mode),
          share_with_family = COALESCE(${validatedData.shareWithFamily}, share_with_family),
          update_interval_sec = COALESCE(${validatedData.updateIntervalSec}, update_interval_sec),
          last_mode_change = CASE WHEN ${validatedData.mode !== undefined} THEN NOW() ELSE last_mode_change END,
          updated_at = NOW()
        WHERE family_member_id = ${validatedData.memberId}
      `
    }

    // A child switching their own sharing off: tell every parent on all channels.
    if (isOwnSettings && targetIsChild && wasSharing) {
      const nowOff = validatedData.mode === "OFF" || validatedData.mode === "PAUSED" || validatedData.shareWithFamily === false
      if (nowOff) await notifyChildStoppedSharing(validatedData.memberId, validatedData.mode === "PAUSED" ? "paused" : "turned off in the app")
    }

    // Audit log
    await logAuditEvent(user.id, "UPDATE", "location_settings", validatedData.memberId, {
      newValue: validatedData as Record<string, unknown>,
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    return NextResponse.json({
      success: true,
      message: "Location settings updated successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Update location settings error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update location settings" },
      { status: 500 }
    )
  }
}
