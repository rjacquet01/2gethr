import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"

// GET - Get user notification settings
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    // Get reminder settings (contains notification preferences)
    const settings = await sql`
      SELECT * FROM reminder_settings WHERE user_id = ${user.id}
    `

    if (settings.length === 0) {
      // Return defaults
      return NextResponse.json({
        success: true,
        data: {
          emailNotifications: true,
          pushNotifications: true,
          smsNotifications: false,
          eventReminders: true,
          locationAlerts: true,
          weeklyDigest: false,
          defaultReminderMinutes: [15],
        }
      })
    }

    // Parse the settings - we store additional prefs in a jsonb column or defaults
    const s = settings[0]
    return NextResponse.json({
      success: true,
      data: {
        emailNotifications: s.email_enabled ?? true,
        pushNotifications: s.push_enabled ?? true,
        smsNotifications: s.sms_enabled ?? false,
        phoneAlerts: s.phone_alerts ?? false,
        eventReminders: true,
        locationAlerts: true,
        weeklyDigest: s.weekly_digest ?? false,
        defaultReminderMinutes: Array.isArray(s.default_reminder_minutes) && s.default_reminder_minutes.length > 0
          ? s.default_reminder_minutes
          : [15],
      }
    })
  } catch (error) {
    console.error("Get notification settings error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get settings" },
      { status: 500 }
    )
  }
}

// PATCH - Update user notification settings
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
    const { 
      emailNotifications, 
      pushNotifications,
      smsNotifications,
      phoneAlerts,
      eventReminders,
      locationAlerts,
      weeklyDigest,
      defaultReminderMinutes,
    } = body

    // Validate the optional default reminder times: a short list of
    // non-negative whole minutes (e.g. [15, 60]). Anything else is ignored
    // rather than stored.
    let reminderMinutesJson: string | null = null
    if (defaultReminderMinutes !== undefined) {
      if (
        !Array.isArray(defaultReminderMinutes) ||
        defaultReminderMinutes.length > 10 ||
        !defaultReminderMinutes.every((m: unknown) => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 10080)
      ) {
        return NextResponse.json(
          { success: false, error: "Invalid default reminder times" },
          { status: 400 }
        )
      }
      reminderMinutesJson = JSON.stringify(defaultReminderMinutes)
    }

    // Check if settings exist
    const existing = await sql`
      SELECT id FROM reminder_settings WHERE user_id = ${user.id}
    `

    if (existing.length === 0) {
      // Create new settings
      await sql`
        INSERT INTO reminder_settings (
          id, user_id, email_enabled, push_enabled, sms_enabled, phone_alerts, weekly_digest,
          default_reminder_minutes, created_at, updated_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${user.id},
          ${emailNotifications ?? true},
          ${pushNotifications ?? true},
          ${smsNotifications ?? false},
          ${phoneAlerts ?? false},
          ${weeklyDigest ?? false},
          COALESCE(
            NULLIF(ARRAY(SELECT jsonb_array_elements_text(${reminderMinutesJson}::jsonb)::int), '{}'::int[]),
            ARRAY[15, 60]
          ),
          NOW(),
          NOW()
        )
      `
    } else {
      // Update existing settings
      await sql`
        UPDATE reminder_settings SET
          email_enabled = COALESCE(${emailNotifications ?? null}::boolean, email_enabled),
          push_enabled = COALESCE(${pushNotifications ?? null}::boolean, push_enabled),
          sms_enabled = COALESCE(${smsNotifications ?? null}::boolean, sms_enabled),
          phone_alerts = COALESCE(${phoneAlerts ?? null}::boolean, phone_alerts),
          weekly_digest = COALESCE(${weeklyDigest ?? null}::boolean, weekly_digest),
          default_reminder_minutes = CASE
            WHEN ${reminderMinutesJson}::text IS NULL THEN default_reminder_minutes
            ELSE ARRAY(SELECT jsonb_array_elements_text(${reminderMinutesJson}::jsonb)::int)
          END,
          updated_at = NOW()
        WHERE user_id = ${user.id}
      `
    }

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully"
    })
  } catch (error) {
    console.error("Update notification settings error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
      { status: 500 }
    )
  }
}
