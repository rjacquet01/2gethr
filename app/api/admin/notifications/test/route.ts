import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { sendSMS, isTwilioConfigured } from '@/lib/services/sms'
import { sendEmail, isResendConfigured } from '@/lib/services/email'
import { sendPushNotification, isFirebaseConfigured } from '@/lib/services/push'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export async function POST(request: Request) {
  try {
    const { admin, error } = await getAdminFromRequest(request)
    if (!admin) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
    }

    const { service, phone, email } = await request.json()

    switch (service) {
      case 'sms': {
        if (!isTwilioConfigured()) {
          return NextResponse.json(
            { error: 'SMS service not configured. Add Twilio environment variables.' },
            { status: 400 }
          )
        }
        
        if (!phone) {
          return NextResponse.json(
            { error: 'Phone number required for SMS test' },
            { status: 400 }
          )
        }

        const result = await sendSMS({
          to: phone,
          body: 'This is a test SMS from Togethr admin portal. If you received this, SMS notifications are working correctly!'
        })

        return NextResponse.json({ success: result.success, error: result.error })
      }

      case 'email': {
        if (!isResendConfigured()) {
          return NextResponse.json(
            { error: 'Email service not configured. Add Resend environment variables.' },
            { status: 400 }
          )
        }
        
        if (!email) {
          return NextResponse.json(
            { error: 'Email address required for email test' },
            { status: 400 }
          )
        }

        const result = await sendEmail({
          to: email,
          subject: 'Togethr Test Email',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
              <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h1 style="color: #3b4563; font-size: 24px; margin: 0 0 20px; text-align: center;">Test Email Successful!</h1>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                    This is a test email from the Togethr admin portal.
                  </p>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                    <strong>Sent by:</strong> ${admin.firstName} ${admin.lastName}<br>
                    <strong>Timestamp:</strong> ${new Date().toLocaleString()}
                  </p>
                  <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
                    If you received this email, your email notifications are working correctly!
                  </p>
                </div>
              </div>
            </body>
            </html>
          `,
          text: `Test Email from Togethr Admin Portal. Sent by: ${admin.firstName} ${admin.lastName} at ${new Date().toLocaleString()}`
        })

        return NextResponse.json({ success: result.success, error: result.error })
      }

      case 'push': {
        if (!isFirebaseConfigured()) {
          return NextResponse.json(
            { error: 'Push service not configured. Add VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY environment variables.' },
            { status: 400 }
          )
        }

        // For push test, we'll just verify the configuration works
        // In a real scenario, you'd send to the admin's registered devices
        return NextResponse.json({ 
          success: true, 
          message: 'Push notification service is configured correctly' 
        })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid service type' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Notification test failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Test failed' },
      { status: 500 }
    )
  }
}
