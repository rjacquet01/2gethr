import { type NextRequest, NextResponse } from "next/server"
import { get } from "@vercel/blob"
import { getUserFromRequest } from "@/lib/auth"

// Serve private blob files with authentication
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Unauthorized" },
        { status: 401 }
      )
    }

    const pathname = request.nextUrl.searchParams.get("pathname")

    if (!pathname) {
      return NextResponse.json(
        { success: false, error: "Missing pathname" },
        { status: 400 }
      )
    }

    // For profile photos, verify the user can access this file
    // Allow access to own profile photo or family member photos
    if (pathname.startsWith("profile-photos/")) {
      const pathUserId = pathname.split("/")[1]
      
      // If not own photo, check if in same family
      if (pathUserId !== user.id && user.primaryFamily) {
        const { sql } = await import("@/lib/db")
        const familyMembers = await sql`
          SELECT user_id FROM family_members 
          WHERE family_id = ${user.primaryFamily.id} 
          AND user_id = ${pathUserId}
          AND is_active = true
        `
        
        if (familyMembers.length === 0) {
          return NextResponse.json(
            { success: false, error: "Access denied" },
            { status: 403 }
          )
        }
      }
    }

    if (pathname.startsWith("place-photos/")) {
      const placeFamilyId = pathname.split("/")[1] || ""
      if (!/^[0-9a-fA-F-]{36}$/.test(placeFamilyId)) {
        return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
      }
      const { sql } = await import("@/lib/db")
      const member = await sql`
        SELECT 1 FROM family_members
        WHERE family_id = ${placeFamilyId} AND user_id = ${user.id} AND is_active = true
      `
      if (member.length === 0) {
        return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
      }
    }

    if (pathname.startsWith("member-photos/")) {
      const photoFamilyId = pathname.split("/")[1] || ""
      if (!/^[0-9a-fA-F-]{36}$/.test(photoFamilyId)) {
        return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
      }
      const { sql } = await import("@/lib/db")
      const member = await sql`
        SELECT 1 FROM family_members
        WHERE family_id = ${photoFamilyId} AND user_id = ${user.id} AND is_active = true
      `
      if (member.length === 0) {
        return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
      }
    }

    const result = await get(pathname, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })

    if (!result) {
      return new NextResponse("Not found", { status: 404 })
    }

    // Blob hasn't changed - tell browser to use cached copy
    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.blob.etag,
          "Cache-Control": "private, no-cache",
        },
      })
    }

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType,
        ETag: result.blob.etag,
        "Cache-Control": "private, no-cache",
      },
    })
  } catch (error) {
    console.error("Error serving file:", error)
    return NextResponse.json(
      { success: false, error: "Failed to serve file" },
      { status: 500 }
    )
  }
}
