import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { clearSmsConsentIfNumberChanges, getSmsConsent } from "@/lib/sms-consent"

// Get user's reminder and notification settings
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: error || "Unauthorized" }, { status: 401 })
    }

    // Get reminder settings
    const reminderSettings = await sql`
      SELECT * FROM reminder_settings WHERE user_id = ${user.id}
    `

    // Get user phone for SMS capability
    const userInfo = await sql`
      SELECT phone FROM users WHERE id = ${user.id}
    `

    const defaults = {
      userId: user.id,
      pushEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
      defaultReminderMinutes: [15, 60],
      quietHoursStart: null,
      quietHoursEnd: null,
      hasPhone: !!userInfo[0]?.phone,
      phoneNumber: userInfo[0]?.phone ? `***${userInfo[0].phone.slice(-4)}` : null,
    }

    if (reminderSettings.length === 0) {
      return NextResponse.json({ settings: defaults })
    }

    const s = reminderSettings[0]
    return NextResponse.json({
      settings: {
        userId: s.user_id,
        pushEnabled: s.push_enabled,
        emailEnabled: s.email_enabled,
        smsEnabled: s.sms_enabled ?? false,
        defaultReminderMinutes: s.default_reminder_minutes || [15],
        quietHoursStart: s.quiet_hours_start,
        quietHoursEnd: s.quiet_hours_end,
        hasPhone: !!userInfo[0]?.phone,
        phoneNumber: userInfo[0]?.phone ? `***${userInfo[0].phone.slice(-4)}` : null,
      }
    })
  } catch (error) {
    console.error("Get reminder settings error:", error)
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 })
  }
}

// Update reminder settings
export async function PUT(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: error || "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { 
      pushEnabled, 
      emailEnabled,
      smsEnabled,
      defaultReminderMinutes, 
      quietHoursStart, 
      quietHoursEnd,
      phoneNumber 
    } = body

    // Texts need consent (lib/sms-consent.ts): this older endpoint can't
    // record it, so it can turn SMS off but not on without it.
    if (smsEnabled === true && !(await getSmsConsent(user.id)).consentedAt) {
      return NextResponse.json({ error: "Turn on text messages in Settings to agree to texts first" }, { status: 400 })
    }

    // Update phone number if provided (a new number needs consent again)
    if (phoneNumber !== undefined) {
      await clearSmsConsentIfNumberChanges(user.id, phoneNumber || null)
      await sql`
        UPDATE users SET phone = ${phoneNumber || null}, updated_at = NOW()
        WHERE id = ${user.id}
      `
    }

    // Upsert notification settings
    await sql`
      INSERT INTO reminder_settings (
        id, user_id, push_enabled, email_enabled, sms_enabled,
        default_reminder_minutes, quiet_hours_start, quiet_hours_end,
        created_at, updated_at
      )
      VALUES (
        ${crypto.randomUUID()}, ${user.id}, ${pushEnabled ?? true}, ${emailEnabled ?? true}, ${smsEnabled ?? false},
        ${defaultReminderMinutes || [15]}, ${quietHoursStart || null}, ${quietHoursEnd || null},
        NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        push_enabled = COALESCE(${pushEnabled}, reminder_settings.push_enabled),
        email_enabled = COALESCE(${emailEnabled}, reminder_settings.email_enabled),
        sms_enabled = COALESCE(${smsEnabled}, reminder_settings.sms_enabled),
        default_reminder_minutes = COALESCE(${defaultReminderMinutes}, reminder_settings.default_reminder_minutes),
        quiet_hours_start = ${quietHoursStart || null},
        quiet_hours_end = ${quietHoursEnd || null},
        updated_at = NOW()
    `

    return NextResponse.json({ success: true, message: "Settings updated" })
  } catch (error) {
    console.error("Update reminder settings error:", error)
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 })
  }
}
