import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { isTwilioConfigured } from '@/lib/services/sms'
import { isResendConfigured } from '@/lib/services/email'
import { isFirebaseConfigured } from '@/lib/services/push'

// Check notification service configuration status
export async function GET(request: Request) {
  try {
    const { admin, error } = await getAdminFromRequest(request)
    if (!admin) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
    }

    // Test results are not stored anywhere (see config-status/route.ts), so
    // lastTested stays null and testsRecorded: false says so.
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

    return NextResponse.json({ success: true, status })
  } catch (error) {
    console.error('Notification status check error:', error)
    return NextResponse.json(
      { error: 'Failed to check notification status' },
      { status: 500 }
    )
  }
}
