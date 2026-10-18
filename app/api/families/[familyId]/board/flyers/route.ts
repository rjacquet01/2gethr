import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { boardAccess, notifyNewPost, shapePosts } from "@/lib/board"
import { deleteBlobUrls, processFlyerImage, readFlyerUpload, storeFlyer } from "@/lib/board-flyers"
import { ensureBoardLimitColumns, expiryFromDate, placePin } from "@/lib/board-limits"
import { POST_MAX, RATE_LIMIT_MESSAGE, ensureSocialTables, overRateLimit } from "@/lib/social"

export const runtime = "nodejs"

// POST - pin a photo flyer: multipart { file, body? (caption), pinned?,
// expiresOn? (YYYY-MM-DD: take it down after that day) }. Parents, guardians
// and adults only. At BOARD_LIMITS.MAX_FLYERS flyers (or MAX_PINS pins) the
// oldest unprotected one is taken down to make room; the response lists
// what came down (rolledOff).
export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardLimitColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!access.canPinFlyers) {
      return NextResponse.json({ success: false, error: "Only parents, guardians and adults can pin photos" }, { status: 403 })
    }
    if (await overRateLimit(user.id, "board")) {
      return NextResponse.json({ success: false, error: RATE_LIMIT_MESSAGE }, { status: 429 })
    }

    const form = await request.formData().catch(() => null)
    if (!form) return NextResponse.json({ success: false, error: "Choose a photo first" }, { status: 400 })
    const upload = await readFlyerUpload(form)
    if ("error" in upload) return NextResponse.json({ success: false, error: upload.error }, { status: upload.status })
    const caption = typeof form.get("body") === "string" ? (form.get("body") as string).trim() : ""
    if (caption.length > POST_MAX) {
      return NextResponse.json({ success: false, error: `Keep it to ${POST_MAX} characters` }, { status: 400 })
    }
    const pinned = form.get("pinned") === "true" && access.canModerate
    const expiresOn = typeof form.get("expiresOn") === "string" ? (form.get("expiresOn") as string).trim() : ""
    let expiresAt: string | null = null
    if (expiresOn) {
      const expiry = await expiryFromDate(familyId, expiresOn)
      if (!expiry) return NextResponse.json({ success: false, error: "That date doesn't look right" }, { status: 400 })
      if (expiry.past) return NextResponse.json({ success: false, error: "Pick today or a later date" }, { status: 400 })
      expiresAt = expiry.expiresAt
    }

    const img = await processFlyerImage(upload.input)
    const id = crypto.randomUUID()
    const stored = await storeFlyer(familyId, id, img)

    // Insert and make room in one transaction under the family lock
    // (lib/board-limits.ts), so parallel uploads can't overfill the board.
    const { rows: ins, rolledOff } = await placePin(
      familyId,
      id,
      sql`
        INSERT INTO family_posts (
          id, family_id, user_id, body, pinned, expires_at,
          flyer_full_path, flyer_full_url, flyer_thumb_path, flyer_thumb_url,
          flyer_width, flyer_height, flyer_uploaded_at
        )
        VALUES (${id}, ${familyId}, ${user.id}, ${caption}, ${pinned}, ${expiresAt}::timestamptz,
          ${stored.fullPath}, ${stored.fullUrl}, ${stored.thumbPath}, ${stored.thumbUrl},
          ${img.width}, ${img.height}, NOW())
        RETURNING id, user_id, body, pinned, keep_up, expires_at, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at
      `
    ).catch(async (err) => {
      // Nothing was saved: don't leave the uploaded files behind.
      await deleteBlobUrls([stored.fullUrl, stored.thumbUrl]).catch(() => {})
      throw err
    })

    await logAuditEvent(user.id, "CREATE", "board_flyer", id, {
      newValue: { familyId, flyerPath: stored.fullPath },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    await notifyNewPost({ familyId, postId: id, user, role: access.role, pinned, body: caption, flyer: true })

    const [shaped] = await shapePosts(familyId, ins)
    return NextResponse.json({ success: true, data: shaped, rolledOff }, { status: 201 })
  } catch (error) {
    console.error("Board flyer POST error:", error)
    return NextResponse.json({ success: false, error: "Could not pin the flyer" }, { status: 500 })
  }
}
