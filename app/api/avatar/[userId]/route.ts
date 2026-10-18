import { type NextRequest, NextResponse } from "next/server"
import { get } from "@vercel/blob"
import { sql } from "@/lib/db"
import { getUserFromRequest, verifyRefreshToken } from "@/lib/auth"

/**
 * Who is asking. <img> tags only carry cookies, and the access cookie lasts
 * 15 minutes, so a valid (unrevoked) refresh cookie also counts; otherwise
 * avatars would break whenever the app sat idle.
 */
async function viewerId(request: NextRequest): Promise<string | null> {
  const { user } = await getUserFromRequest(request)
  if (user) return user.id
  const refresh = request.cookies.get("refresh_token")?.value
  if (!refresh) return null
  const payload = await verifyRefreshToken(refresh)
  if (!payload?.userId) return null
  const live = await sql`
    SELECT 1 FROM refresh_tokens
    WHERE token = ${refresh} AND revoked_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `
  return live.length > 0 ? payload.userId : null
}

// Serve user avatars to the user themselves and people they share a family
// with. Profile photos (children's included) are not public.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    if (!userId) {
      return new NextResponse("User ID required", { status: 400 })
    }

    const viewer = await viewerId(request)
    if (!viewer) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
    if (viewer !== userId) {
      const shared = await sql`
        SELECT 1 FROM family_members a
        JOIN family_members b ON b.family_id = a.family_id
        WHERE a.user_id = ${viewer} AND a.is_active = true
          AND b.user_id = ${userId} AND b.is_active = true
        LIMIT 1
      `
      if (shared.length === 0) {
        return new NextResponse("Not found", { status: 404 })
      }
    }

    // Get the user's profile photo path from database
    const users = await sql`
      SELECT profile_photo_path FROM users WHERE id = ${userId}
    `

    if (users.length === 0 || !users[0].profile_photo_path) {
      // Return a placeholder or 404
      return new NextResponse("No avatar", { status: 404 })
    }

    const pathname = users[0].profile_photo_path

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
          // "public" would let shared/CDN caches keep serving this response
          // under the stable /api/avatar/{userId} URL even after the user
          // uploads a new photo (the pathname/etag changes, but nothing
          // busts the old cached entry). Scope caching to the browser only,
          // per Vercel's private-blob-serving guidance, so a new upload is
          // reflected as soon as the browser revalidates.
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
    console.error("Error serving avatar:", error)
    return new NextResponse("Failed to serve avatar", { status: 500 })
  }
}
