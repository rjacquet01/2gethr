import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { boardAccess, shapePosts } from "@/lib/board"
import {
  clearFlyerColumns,
  deleteBlobUrls,
  deleteFlyerFiles,
  ensureBoardFlyerColumns,
  flyerStore,
  processFlyerImage,
  readFlyerUpload,
  storeFlyer,
} from "@/lib/board-flyers"
import { BOARD_FLYER } from "@/lib/constants"
import { ensureSocialTables } from "@/lib/social"

export const runtime = "nodejs"

type Params = { params: Promise<{ familyId: string; postId: string }> }

async function setup(request: NextRequest, familyId: string) {
  const { user } = await getUserFromRequest(request)
  if (!user) return { response: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }), user: null, access: null } as const
  await ensureSocialTables()
  await ensureBoardFlyerColumns()
  const access = await boardAccess(familyId, user.id)
  if (access instanceof NextResponse) return { response: access, user: null, access: null } as const
  return { response: null, user, access } as const
}

async function loadFlyerPost(familyId: string, postId: string) {
  const rows = await sql`
    SELECT id, user_id, body, flyer_full_path, flyer_full_url, flyer_thumb_path, flyer_thumb_url
    FROM family_posts
    WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL AND flyer_full_path IS NOT NULL
    LIMIT 1
  `
  return rows[0] || null
}

const notFound = () => NextResponse.json({ success: false, error: "Flyer not found" }, { status: 404 })

// GET ?size=thumb|full - the flyer image, for non-guest members of the family
// only. Cached privately by the browser for a day (the URL changes when the
// flyer is replaced), so repeat views don't re-download from storage.
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { familyId, postId } = await params
    const ctx = await setup(request, familyId)
    if (ctx.response) return ctx.response
    const post = await loadFlyerPost(familyId, postId)
    if (!post) return notFound()
    const size = request.nextUrl.searchParams.get("size") === "full" ? "full" : "thumb"
    const path = (size === "full" ? post.flyer_full_path : post.flyer_thumb_path) as string | null
    if (!path) return notFound()

    const cache = `private, max-age=${BOARD_FLYER.IMAGE_CACHE_SECONDS}`
    const result = await flyerStore.get(path, request.headers.get("if-none-match") ?? undefined)
    if (!result) return notFound()
    if (result.statusCode === 304) {
      return new NextResponse(null, { status: 304, headers: { ETag: result.blob.etag, "Cache-Control": cache } })
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": "image/jpeg",
        ETag: result.blob.etag,
        "Cache-Control": cache,
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Board flyer GET error:", error)
    return NextResponse.json({ success: false, error: "Could not load the flyer" }, { status: 500 })
  }
}

// PUT - replace the photo (multipart { file }): the poster or a parent, and
// only someone allowed to pin photos. The old files are deleted.
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { familyId, postId } = await params
    const ctx = await setup(request, familyId)
    if (ctx.response) return ctx.response
    const { user, access } = ctx
    const post = await loadFlyerPost(familyId, postId)
    if (!post) return notFound()
    if (!access.canPinFlyers || (post.user_id !== user.id && !access.canModerate)) {
      return NextResponse.json({ success: false, error: "You can't change this flyer" }, { status: 403 })
    }

    const form = await request.formData().catch(() => null)
    if (!form) return NextResponse.json({ success: false, error: "Choose a photo first" }, { status: 400 })
    const upload = await readFlyerUpload(form)
    if ("error" in upload) return NextResponse.json({ success: false, error: upload.error }, { status: upload.status })

    const img = await processFlyerImage(upload.input)
    const stored = await storeFlyer(familyId, postId, img)
    const upd = await sql`
      UPDATE family_posts SET
        flyer_full_path = ${stored.fullPath}, flyer_full_url = ${stored.fullUrl},
        flyer_thumb_path = ${stored.thumbPath}, flyer_thumb_url = ${stored.thumbUrl},
        flyer_width = ${img.width}, flyer_height = ${img.height}, flyer_uploaded_at = NOW()
      WHERE id = ${postId} AND deleted_at IS NULL
      RETURNING id, user_id, body, pinned, created_at, flyer_thumb_path, flyer_width, flyer_height, flyer_uploaded_at
    `
    if (upd.length === 0) {
      await deleteBlobUrls([stored.fullUrl, stored.thumbUrl]).catch(() => {})
      return notFound()
    }
    await deleteFlyerFiles([post as { id: string; flyer_full_url: string; flyer_thumb_url: string }])

    await logAuditEvent(user.id, "UPDATE", "board_flyer", postId, {
      newValue: { familyId, flyerPath: stored.fullPath },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    const [shaped] = await shapePosts(familyId, upd)
    return NextResponse.json({ success: true, data: shaped })
  } catch (error) {
    console.error("Board flyer PUT error:", error)
    return NextResponse.json({ success: false, error: "Could not replace the flyer" }, { status: 500 })
  }
}

// DELETE - remove the photo (the poster or a parent). A flyer with no
// caption has nothing left to show, so the post goes too.
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { familyId, postId } = await params
    const ctx = await setup(request, familyId)
    if (ctx.response) return ctx.response
    const { user, access } = ctx
    const post = await loadFlyerPost(familyId, postId)
    if (!post) return notFound()
    if (post.user_id !== user.id && !access.canModerate) {
      return NextResponse.json({ success: false, error: "You can only remove your own flyers" }, { status: 403 })
    }

    const done = await deleteFlyerFiles([post as { id: string; flyer_full_url: string; flyer_thumb_url: string }])
    if (!done.has(postId)) {
      return NextResponse.json({ success: false, error: "Could not remove the flyer, try again" }, { status: 502 })
    }
    await clearFlyerColumns([postId])
    const postRemoved = !String(post.body || "").trim()
    if (postRemoved) await sql`UPDATE family_posts SET deleted_at = NOW() WHERE id = ${postId}`

    await logAuditEvent(user.id, "DELETE", "board_flyer", postId, {
      oldValue: { familyId, flyerPath: post.flyer_full_path },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    return NextResponse.json({ success: true, data: { postRemoved } })
  } catch (error) {
    console.error("Board flyer DELETE error:", error)
    return NextResponse.json({ success: false, error: "Could not remove the flyer" }, { status: 500 })
  }
}
