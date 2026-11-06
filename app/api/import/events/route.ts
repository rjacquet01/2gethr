import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { getMemberAccess } from "@/lib/permissions"
import { flyerStore, isBoardAdult, processFlyerImage, readFlyerUpload } from "@/lib/board-flyers"
import { ensureBoardLimitColumns, expiryCutoff, isVisibleRow } from "@/lib/board-limits"
import { ensureSocialTables } from "@/lib/social"
import { hitRateLimit, tooManyRequests } from "@/lib/rate-limit"
import { isValidTimeZone } from "@/lib/recurrence"
import {
  SMART_IMPORT_COPY,
  SMART_IMPORT_MAX_TEXT,
  SMART_IMPORT_RATE,
  parseImportOutput,
  smartImportEnabled,
  todayIn,
} from "@/lib/smart-import"
import { providerErrorLabel, smartImportAi } from "@/lib/smart-import-ai"
import { claimSmartImport, releaseSmartImport, smartImportUsage } from "@/lib/smart-import-quota"

export const runtime = "nodejs"
export const maxDuration = 60

// Smart Import: read a flyer photo or pasted text into suggested events.
// Never writes to the calendar; the review page adds the ones the person
// keeps through POST /api/events. With SMART_IMPORT_ENABLED off, 404.

const notFound = () => NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status })

async function memberCheck(familyId: unknown, userId: string): Promise<string | NextResponse> {
  if (typeof familyId !== "string" || !familyId) return bad("familyId is required")
  const access = await getMemberAccess(familyId, userId)
  if (!access) return bad("Not a member of this family", 403)
  // Adults only (PARENT / GUARDIAN / ADULT / ADMIN); children and guests never see it.
  if (!isBoardAdult(access.role)) return bad("Only adults can import events", 403)
  return familyId
}

// GET ?familyId= : whether import is on, and this month's count.
export async function GET(request: NextRequest) {
  if (!smartImportEnabled()) return notFound()
  const { user } = await getUserFromRequest(request)
  if (!user) return bad("Not authenticated", 401)
  const familyId = await memberCheck(request.nextUrl.searchParams.get("familyId"), user.id)
  if (familyId instanceof NextResponse) return familyId
  const usage = await smartImportUsage(familyId)
  const inApp = request.cookies.get("togethr_android")?.value === "1"
  return NextResponse.json({ success: true, data: { enabled: true, ...usage, upgradeTo: inApp ? null : usage.upgradeTo } })
}

// POST JSON { familyId, postId } or { familyId, text }, or multipart
// (familyId, file). Optional timeZone (IANA) for resolving "next Friday".
export async function POST(request: NextRequest) {
  if (!smartImportEnabled()) return notFound()
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) return bad("Not authenticated", 401)

    let familyIdRaw: unknown
    let postId: unknown
    let text: unknown
    let tzRaw: unknown
    let form: FormData | null = null
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      form = await request.formData().catch(() => null)
      if (!form) return bad("Couldn't read that upload")
      familyIdRaw = form.get("familyId")
      tzRaw = form.get("timeZone")
    } else {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== "object") return bad("Invalid request")
      ;({ familyId: familyIdRaw, postId, text, timeZone: tzRaw } = body as Record<string, unknown>)
    }

    const familyId = await memberCheck(familyIdRaw, user.id)
    if (familyId instanceof NextResponse) return familyId

    // Load the one image or text first, so a bad input never counts.
    let image: Buffer | undefined
    let source: "post" | "photo" | "text"
    if (form) {
      const upload = await readFlyerUpload(form)
      if ("error" in upload) return bad(upload.error, upload.status)
      image = (await processFlyerImage(upload.input)).full
      source = "photo"
    } else if (typeof postId === "string" && postId) {
      await ensureSocialTables()
      await ensureBoardLimitColumns()
      const rows = await sql`
        SELECT flyer_full_path, taken_down_at, keep_up, expires_at
        FROM family_posts
        WHERE id = ${postId} AND family_id = ${familyId} AND deleted_at IS NULL AND flyer_full_path IS NOT NULL
        LIMIT 1
      `
      const post = rows[0]
      if (!post || !isVisibleRow(post, await expiryCutoff(familyId))) return bad("Flyer not found", 404)
      const blob = await flyerStore.get(post.flyer_full_path as string)
      if (!blob || blob.statusCode !== 200) return bad("Flyer not found", 404)
      image = Buffer.from(await new Response(blob.stream).arrayBuffer())
      source = "post"
    } else if (typeof text === "string" && text.trim()) {
      if (text.length > SMART_IMPORT_MAX_TEXT) return bad(`That's too much text (max ${SMART_IMPORT_MAX_TEXT.toLocaleString("en-US")} characters)`)
      source = "text"
    } else {
      return bad("Choose a photo or paste some text")
    }

    const rate = await hitRateLimit(`smart-import:${user.id}`, SMART_IMPORT_RATE.limit, SMART_IMPORT_RATE.windowSec)
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSec, "imports")

    const slot = await claimSmartImport(familyId)
    if (!slot.allowed) {
      const inApp = request.cookies.get("togethr_android")?.value === "1"
      return NextResponse.json(
        {
          success: false,
          error: SMART_IMPORT_COPY.overCap,
          code: "PLAN_LIMIT",
          limit: { kind: "smartImport", used: slot.used, limit: slot.limit, upgradeTo: inApp ? null : slot.upgradeTo },
        },
        { status: 402 }
      )
    }

    const timeZone = typeof tzRaw === "string" && isValidTimeZone(tzRaw)
      ? tzRaw
      : isValidTimeZone(user.timezone) ? user.timezone : "America/New_York"
    const today = todayIn(timeZone)
    let raw: unknown
    try {
      raw = await smartImportAi.extract({ image, text: image ? undefined : (text as string), timeZone, today })
    } catch (err) {
      await releaseSmartImport(familyId).catch(() => {})
      console.error(`[smart-import] provider failure (${source}): ${providerErrorLabel(err)}`)
      return NextResponse.json({ success: false, error: SMART_IMPORT_COPY.unavailable }, { status: 503 })
    }

    const events = parseImportOutput(raw, today.date)
    // Counts only, never what was read.
    console.info(`[smart-import] ${source}: ${events.length} event(s)`)
    return NextResponse.json({
      success: true,
      data: {
        events,
        message: events.length === 0 ? SMART_IMPORT_COPY.nothingFound : null,
        used: slot.used,
        limit: slot.limit,
      },
    })
  } catch (error) {
    console.error("[smart-import] error:", (error as Error)?.name)
    return NextResponse.json({ success: false, error: "Could not import that" }, { status: 500 })
  }
}
