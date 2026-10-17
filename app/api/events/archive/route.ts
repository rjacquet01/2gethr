import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { verifyAccessToken } from "@/lib/auth"
import { isAdultMemberRole } from "@/lib/permissions"
import { cookies } from "next/headers"

export async function POST(request: Request) {
  try {
    // Verify authentication
    const cookieStore = await cookies()
    const token = cookieStore.get("access_token")?.value
    
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    
    const payload = await verifyAccessToken(token)
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }
    
    const body = await request.json()
    const { familyId, action } = body
    
    if (!familyId) {
      return NextResponse.json({ error: "Family ID is required" }, { status: 400 })
    }
    
    // Verify user has access to this family
    const memberCheck = await sql`
      SELECT fm.role FROM family_members fm
      WHERE fm.family_id = ${familyId} AND fm.user_id = ${payload.userId}
        AND fm.is_active = true
    `
    
    if (memberCheck.length === 0) {
      return NextResponse.json({ error: "Not a member of this family" }, { status: 403 })
    }
    
    // family_role enum is PARENT / GUARDIAN / ADULT / CHILD / GUEST; the owner is families.owner_id
    const role = memberCheck[0].role
    const ownerRow = await sql`SELECT 1 FROM families WHERE id = ${familyId} AND owner_id = ${payload.userId}`
    const isAdult = isAdultMemberRole(role)
    // A guest may archive only their own past events (the ones they created).
    const guestUserId: string | null = role === "GUEST" ? payload.userId : null
    if (!isAdult && ownerRow.length === 0 && !guestUserId) {
      return NextResponse.json({ error: "Only parents, guardians and adult members can archive events" }, { status: 403 })
    }
    
    if (action === 'archive_past') {
      // Archive all past events for this family
      const result = await sql`
        UPDATE events e
        SET status = 'ARCHIVED'
        FROM calendars c
        WHERE e.calendar_id = c.id
        AND c.family_id = ${familyId}
        AND e.end_time < NOW()
        AND e.status != 'ARCHIVED'
        AND e.status != 'CANCELLED'
        AND (${guestUserId}::text IS NULL OR e.created_by_id = ${guestUserId})
      `
      
      return NextResponse.json({
        success: true,
        message: `Past events have been archived`,
      })
    }
    
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    
  } catch (error) {
    console.error("Archive events error:", error)
    return NextResponse.json(
      { error: "Failed to archive events" },
      { status: 500 }
    )
  }
}
