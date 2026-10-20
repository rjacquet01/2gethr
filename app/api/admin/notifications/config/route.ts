import { NextRequest, NextResponse } from "next/server"
import { getAdminFromToken } from "@/lib/admin-auth"

// POST - Save notification service configuration
// Note: This endpoint provides guidance on configuring services via environment variables
// Actual credentials should be set in Vercel Environment Variables for security
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.split(" ")[1]
    // The full check (active admin, access token, two-step sign-in), not just the signature.
    const admin = await getAdminFromToken(token)
    if (!admin) {
      return NextResponse.json({ error: "Invalid admin token" }, { status: 401 })
    }

    const { service, config } = await request.json()

    // Validate required fields based on service
    switch (service) {
      case 'twilio':
        if (!config.accountSid || !config.authToken || !config.phoneNumber) {
          return NextResponse.json({ 
            error: "Missing required Twilio configuration. Please provide accountSid, authToken, and phoneNumber.",
            instructions: "Add these as environment variables in Vercel: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER"
          }, { status: 400 })
        }
        // For security, we don't store credentials in the database
        // Instead, guide users to set environment variables
        return NextResponse.json({ 
          success: true, 
          message: "Twilio configuration validated. Please ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are set in your Vercel Environment Variables.",
          configured: true
        })

      case 'resend':
        if (!config.apiKey) {
          return NextResponse.json({ 
            error: "Missing Resend API key.",
            instructions: "Add RESEND_API_KEY as an environment variable in Vercel"
          }, { status: 400 })
        }
        return NextResponse.json({ 
          success: true, 
          message: "Resend configuration validated. Please ensure RESEND_API_KEY and EMAIL_FROM are set in your Vercel Environment Variables.",
          configured: true
        })

      case 'vapid':
        if (!config.publicKey || !config.privateKey) {
          return NextResponse.json({
            error: "Missing required VAPID configuration.",
            instructions: "Add NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY as environment variables in Vercel"
          }, { status: 400 })
        }
        return NextResponse.json({
          success: true,
          message: "VAPID configuration validated. Please ensure NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set in your Vercel Environment Variables.",
          configured: true
        })

      default:
        return NextResponse.json({ error: "Unknown service" }, { status: 400 })
    }
  } catch (error) {
    console.error("Save config error:", error)
    return NextResponse.json({ error: "Failed to save configuration" }, { status: 500 })
  }
}
