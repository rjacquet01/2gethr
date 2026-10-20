import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyAccessToken, getUserWithFamily } from "@/lib/auth"
import { needsAgeTermsConfirmation } from "@/lib/existing-user-confirmations"

export async function GET(request: NextRequest) {
  try {
    // First try Authorization header (for localStorage-based auth)
    const authHeader = request.headers.get("Authorization")
    let accessToken: string | undefined
    
    if (authHeader?.startsWith("Bearer ")) {
      accessToken = authHeader.substring(7)
    }
    
    // Fallback to cookies
    if (!accessToken) {
      const cookieStore = await cookies()
      accessToken = cookieStore.get("access_token")?.value
    }
    
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "No authentication token" },
        { status: 401 }
      )
    }
    
    // Verify the token
    const payload = await verifyAccessToken(accessToken)
    if (!payload || !payload.userId) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 }
      )
    }
    
    // Get full user data
    const user = await getUserWithFamily(payload.userId)
    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 401 }
      )
    }

    // Transform to match frontend User interface
    const transformedUser = {
      id: user.id,
      email: user.email,
      // The settings form edits these; without them it loaded blank names and
      // saving any field wiped the stored name.
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      avatarUrl: user.profilePhotoPath ? `/api/avatar/${user.id}` : null, // Use avatar endpoint for private blob access
      phone: user.phone,
      timezone: user.timezone,
      createdAt: user.createdAt,
      // Include family data for dashboard
      primaryFamily: user.primaryFamily,
      primaryFamilyRole: user.primaryFamilyRole,
      permissions: user.permissions,
      // An adult from before the age rule: the app asks once (never a child account).
      needsAgeTermsConfirmation: await needsAgeTermsConfirmation(user.id).catch((err) => {
        console.error("Age/terms check failed (non-fatal):", err)
        return false
      }),
    }

    return NextResponse.json({ user: transformedUser })
  } catch (error) {
    console.error("Get current user error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to get user" },
      { status: 500 }
    )
  }
}
