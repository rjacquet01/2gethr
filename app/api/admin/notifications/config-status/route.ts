import { NextResponse } from 'next/server'
import { isTwilioConfigured } from '@/lib/services/sms'
import { isResendConfigured } from '@/lib/services/email'
import { isFirebaseConfigured } from '@/lib/services/push'

// Note: This read-only status check doesn't require admin auth
// since it's already accessed from the admin dashboard
export async function GET() {
  try {
    // Test results are not stored anywhere: POST /api/admin/notifications/test
    // returns the result to the browser but writes no log row, and no existing
    // table records sends (notification_deliveries is never written). So there
    // is no last-tested time to report; testsRecorded: false says so honestly
    // instead of implying a service was "never tested".
    const status = {
      sms: {
        configured: isTwilioConfigured(),
        provider: 'Twilio',
        lastTested: null,
        lastTestResult: null,
        testsRecorded: false
      },
      email: {
        configured: isResendConfigured(),
        provider: 'Resend',
        lastTested: null,
        lastTestResult: null,
        testsRecorded: false
      },
      push: {
        configured: isFirebaseConfigured(),
        provider: 'Web Push (VAPID)',
        lastTested: null,
        lastTestResult: null,
        testsRecorded: false
      }
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error('Error checking notification status:', error)
    return NextResponse.json(
      { error: 'Failed to check notification status' },
      { status: 500 }
    )
  }
}
