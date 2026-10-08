import { sql } from "./db"
import { sendPushToUser, isFirebaseConfigured } from "./services/push"
import { sendSMS, isTwilioConfigured } from "./services/sms"
import { sendEmail, isResendConfigured } from "./services/email"

interface AlertOptions {
  title: string
  body: string
  type?: string // notifications.type
  data?: Record<string, unknown>
  clickAction?: string
  /** Emergencies also text/email people who haven't opted in to SMS. */
  urgent?: boolean
}

/**
 * Tell every parent/guardian in the family (except the person the alert is
 * about) through in-app, push, SMS and email, honouring each recipient's own
 * channel toggles unless the alert is urgent.
 */
export async function alertFamilyAdults(familyId: string, aboutUserId: string, opts: AlertOptions) {
  const recipients = await sql`
    SELECT fm.user_id, u.email, u.phone, rs.email_enabled, rs.sms_enabled, rs.push_enabled
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN reminder_settings rs ON rs.user_id = fm.user_id
    WHERE fm.family_id = ${familyId}
      AND fm.role IN ('PARENT', 'GUARDIAN')
      AND fm.is_active = true
      AND fm.user_id != ${aboutUserId}
  `
  let delivered = 0
  for (const r of recipients) {
    try {
      await sql`
        INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
        VALUES (
          ${`notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`},
          ${r.user_id}, ${opts.type || "LOCATION_ALERT"}, ${opts.title}, ${opts.body},
          ${JSON.stringify(opts.data || {})}::jsonb, NOW()
        )
      `
      delivered++
    } catch (err) {
      console.error("alertFamilyAdults in-app failed:", err)
    }
    if ((opts.urgent || (r.push_enabled ?? true)) && isFirebaseConfigured()) {
      try {
        await sendPushToUser(r.user_id, {
          title: opts.title,
          body: opts.body,
          // FCM data payloads only carry strings.
          data: Object.fromEntries(
            Object.entries({ type: opts.type || "LOCATION_ALERT", ...(opts.data || {}) })
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)])
          ),
          clickAction: opts.clickAction || "/location",
        })
      } catch (err) {
        console.error("alertFamilyAdults push failed:", err)
      }
    }
    const smsOk = opts.urgent ? r.sms_enabled !== false : r.sms_enabled === true
    if (smsOk && r.phone && isTwilioConfigured()) {
      try {
        await sendSMS({ to: r.phone, body: `Togethr: ${opts.title} - ${opts.body}`.substring(0, 300) })
      } catch (err) {
        console.error("alertFamilyAdults sms failed:", err)
      }
    }
    const emailOk = opts.urgent ? r.email_enabled !== false : (r.email_enabled ?? true)
    if (emailOk && r.email && isResendConfigured() && opts.urgent) {
      try {
        await sendEmail({
          to: r.email,
          subject: opts.title,
          html: `<p><strong>${opts.title}</strong></p><p>${opts.body}</p>`,
          text: `${opts.title}\n\n${opts.body}`,
        })
      } catch (err) {
        console.error("alertFamilyAdults email failed:", err)
      }
    }
  }
  return delivered
}
