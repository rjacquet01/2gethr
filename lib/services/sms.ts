/**
 * SMS Service using Twilio
 * 
 * Required environment variables:
 * - TWILIO_ACCOUNT_SID: Your Twilio Account SID
 * - TWILIO_AUTH_TOKEN: Your Twilio Auth Token  
 * - TWILIO_PHONE_NUMBER: Your Twilio phone number (e.g., +1234567890)
 */

interface SMSPayload {
  to: string
  body: string
}

interface SMSResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Check if Twilio is configured
 */
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  )
}

/**
 * Send SMS via Twilio
 */
export async function sendSMS({ to, body }: SMSPayload): Promise<SMSResult> {
  if (!isTwilioConfigured()) {
    console.warn('Twilio not configured - SMS not sent')
    return { success: false, error: 'Twilio not configured' }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const fromNumber = process.env.TWILIO_PHONE_NUMBER!

  try {
    // Format phone number (ensure it starts with +)
    // Normalize to E.164. Numbers are stored in several shapes ("6176789621",
    // "16176789621", "(617) 678-9621", "+16176789621"); blindly prefixing +1
    // turned an 11-digit "1617..." into an invalid "+1617..." with an extra 1.
    const digits = to.replace(/\D/g, '')
    const formattedTo = to.trim().startsWith('+')
      ? `+${digits}`
      : digits.length === 11 && digits.startsWith('1')
        ? `+${digits}`
        : `+1${digits}`

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: formattedTo,
          From: fromNumber,
          Body: body,
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Twilio error:', data)
      return { 
        success: false, 
        error: data.message || 'Failed to send SMS' 
      }
    }

    return { 
      success: true, 
      messageId: data.sid 
    }
  } catch (error) {
    console.error('SMS send error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Send SMS to multiple recipients
 */
export async function sendBulkSMS(
  recipients: string[],
  body: string
): Promise<{ sent: number; failed: number; results: SMSResult[] }> {
  const results: SMSResult[] = []
  let sent = 0
  let failed = 0

  for (const to of recipients) {
    const result = await sendSMS({ to, body })
    results.push(result)
    if (result.success) {
      sent++
    } else {
      failed++
    }
  }

  return { sent, failed, results }
}

// SMS Templates for Togethr
export const SMS_TEMPLATES = {
  GEOFENCE_ARRIVAL: (childName: string, placeName: string) =>
    `Togethr Alert: ${childName} has arrived at ${placeName}.`,

  GEOFENCE_DEPARTURE: (childName: string, placeName: string) =>
    `Togethr Alert: ${childName} has left ${placeName}.`,

  EVENT_REMINDER: (eventTitle: string, time: string) =>
    `Togethr Reminder: "${eventTitle}" starts at ${time}.`,

  TASK_OVERDUE: (taskTitle: string, childName: string) =>
    `Togethr Alert: Task "${taskTitle}" assigned to ${childName} is overdue.`,

  EMERGENCY_ALERT: (childName: string, message: string) =>
    `Togethr EMERGENCY: ${childName} - ${message}`,

  LOCATION_CHECK_IN: (childName: string, location: string) =>
    `Togethr: ${childName} checked in at ${location}.`,

  VERIFICATION_CODE: (code: string) =>
    `Your Togethr verification code is: ${code}. Valid for 10 minutes.`,
}
