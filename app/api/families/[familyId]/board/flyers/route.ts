import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { boardAccess, notifyNewPost, shapePosts } from "@/lib/board"
import {
  FLYER_LIMIT_MESSAGE,
  activeFlyerCount,
  deleteBlobUrls,
  ensureBoardFlyerColumns,
  processFlyerImage,
  readFlyerUpload,
  storeFlyer,
} from "@/lib/board-flyers"
import { BOARD_FLYER } from "@/lib/constants"
import { POST_MAX, RATE_LIMIT_MESSAGE, ensureSocialTables, overRateLimit } from "@/lib/social"

export const runtime = "nodejs"

// POST - pin a photo flyer: multipart { file, body? (caption), pinned? }.
// Any family member (guests have no board); at most BOARD_FLYER.MAX_ACTIVE_PER_FAMILY
// live flyers per family.
export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await ensureSocialTables()
    await ensureBoardFlyerColumns()
    const access = await boardAccess(familyId, user.id)
    if (access instanceof NextResponse) return access
    if (!access.canPinFlyers) {
      return NextResponse.json({ success: false, error: "Only family members can pin photos" }, { status: 403 })
    }
    if (await overRateLimit(user.id, "board")) {
      return NextResponse.json({ success: false, error: RATE_LIMIT_MESSAGE }, { status: 429 })
    }
    if ((await activeFlyerCount(familyId)) >= BOARD_FLYER.MAX_ACTIVE_PER_FAMILY) {
      return NextResponse.json({ success: false, error: FLYER_LIMIT_MESSAGE }, { status: 400 })
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

    const img = await processFlyerImage(upload.input)
    const id = crypto.randomUUID()
    const stored = await storeFlyer(familyId, id, img)

    // The cap check and insert run under a per-family lock, so two uploads at
    // the same moment can't both slip in as flyer number 20.
    const [, ins] = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext(${`board-flyers:${familyId}`}))`,
      sql`
        INSERT INTO family_posts (
          id, family_id, user_id, body, pinned,
          flyer_full_path, flyer_full_url, flyer_thumb_path, flyer_thumb_url,
          flyer_width, flyer_height, flyer_uploaded_at
        )
        SELECT ${id}, ${familyId}, ${user.id}, ${caption}, ${pinned},
          ${stored.fullPath}, ${stored.fullUrl}, ${stored.thumbPath}, ${stored.thumbUrl},
          ${img.width}, ${img.height}, NOW()
        WHERE (
          SELECT count(*) FROM family_posts
          WHERE family_id = ${familyId} AND flyer_full_path IS NOT NULL AND deleted_at IS NULL
        ) < ${BOARD_FLYER.MAX_ACTIVE_PER_FAMILY}
        RETURNING id, user_id, body, pinned, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at
      `,
    ])
    if (ins.length === 0) {
      await deleteBlobUrls([stored.fullUrl, stored.thumbUrl]).catch(() => {})
      return NextResponse.json({ success: false, error: FLYER_LIMIT_MESSAGE }, { status: 400 })
    }

    await logAuditEvent(user.id, "CREATE", "board_flyer", id, {
      newValue: { familyId, flyerPath: stored.fullPath },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    await notifyNewPost({ familyId, postId: id, user, role: access.role, pinned, body: caption, flyer: true })

    const [shaped] = await shapePosts(familyId, ins)
    return NextResponse.json({ success: true, data: shaped }, { status: 201 })
  } catch (error) {
    console.error("Board flyer POST error:", error)
    return NextResponse.json({ success: false, error: "Could not pin the flyer" }, { status: 500 })
  }
}
