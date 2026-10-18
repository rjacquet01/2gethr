import { put, del, get } from "@vercel/blob"
import sharp from "sharp"
import { sql } from "./db"
import { BOARD_FLYER } from "./constants"
import { ensureSocialTables } from "./social"

// Photo flyers on the family board: schema, image processing, private Blob
// storage and cleanup. Every place that removes a post (the poster, a family
// delete, account closure, the 90-day purge) deletes the files through
// deleteFlyerFiles() first, so no image outlives its post.

let ensured: Promise<void> | null = null

/** Lazy idempotent schema (scripts/add-board-flyers.sql adds the same up front). */
export function ensureBoardFlyerColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ensureSocialTables()
      await sql`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_full_path TEXT`
      await sql`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_full_url TEXT`
      await sql`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_thumb_path TEXT`
      await sql`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_thumb_url TEXT`
      await sql`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_width INTEGER`
      await sql`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_height INTEGER`
      await sql`ALTER TABLE family_posts ADD COLUMN IF NOT EXISTS flyer_uploaded_at TIMESTAMPTZ`
      await sql`
        CREATE INDEX IF NOT EXISTS idx_family_posts_flyers ON family_posts(family_id)
        WHERE flyer_full_path IS NOT NULL AND deleted_at IS NULL
      `
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

/**
 * Blob access goes through this object so tests can swap in fakes and never
 * touch real storage.
 */
export const flyerStore = {
  put: (pathname: string, body: Buffer) =>
    put(pathname, body, { access: "private", contentType: "image/jpeg", addRandomSuffix: false }),
  del: (urls: string[]) => del(urls),
  get: (pathname: string, ifNoneMatch?: string) => get(pathname, { access: "private", ifNoneMatch }),
}

/** Adults may pin photo flyers; kids post text notes only, guests nothing. */
export function canPinFlyers(role: string): boolean {
  return ["PARENT", "GUARDIAN", "ADULT", "ADMIN"].includes(role)
}

export interface ProcessedFlyer {
  full: Buffer
  thumb: Buffer
  width: number
  height: number
}

/**
 * Fix phone rotation, shrink, and re-encode as JPEG (re-encoding also strips
 * EXIF, including GPS). Throws on anything sharp can't read as an image.
 */
export async function processFlyerImage(input: Buffer): Promise<ProcessedFlyer> {
  const base = sharp(input, { failOn: "error", limitInputPixels: 50_000_000 }).rotate()
  const { data: full, info } = await base
    .clone()
    .resize(BOARD_FLYER.FULL_MAX_PX, BOARD_FLYER.FULL_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: BOARD_FLYER.JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  const thumb = await base
    .clone()
    .resize(BOARD_FLYER.THUMB_MAX_PX, BOARD_FLYER.THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: BOARD_FLYER.JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
  return { full, thumb, width: info.width, height: info.height }
}

export interface StoredFlyer {
  fullPath: string
  fullUrl: string
  thumbPath: string
  thumbUrl: string
}

/** Upload both sizes privately under board-flyers/{familyId}/{postId}-{ts}-*.jpg. */
export async function storeFlyer(familyId: string, postId: string, img: ProcessedFlyer): Promise<StoredFlyer> {
  const stem = `${BOARD_FLYER.PATH_PREFIX}/${familyId}/${postId}-${Date.now()}`
  const full = await flyerStore.put(`${stem}-full.jpg`, img.full)
  try {
    const thumb = await flyerStore.put(`${stem}-thumb.jpg`, img.thumb)
    return { fullPath: full.pathname, fullUrl: full.url, thumbPath: thumb.pathname, thumbUrl: thumb.url }
  } catch (err) {
    await deleteBlobUrls([full.url]).catch(() => {})
    throw err
  }
}

/** Delete blobs; a file that is already gone counts as deleted. */
export async function deleteBlobUrls(urls: string[]): Promise<void> {
  const list = urls.filter(Boolean)
  if (list.length === 0) return
  try {
    await flyerStore.del(list)
  } catch (err) {
    const name = (err as Error)?.name || ""
    if (/NotFound/i.test(name)) return
    throw err
  }
}

export interface FlyerFileRow {
  id: string
  flyer_full_url?: string | null
  flyer_thumb_url?: string | null
}

/**
 * Delete the full and thumbnail files of these posts. Returns the ids whose
 * files are gone; a post whose delete failed is left out so its row is kept
 * and the next run tries again (no orphaned files).
 */
export async function deleteFlyerFiles(rows: FlyerFileRow[]): Promise<Set<string>> {
  const done = new Set<string>()
  for (const r of rows) {
    const urls = [r.flyer_full_url, r.flyer_thumb_url].filter((u): u is string => !!u)
    try {
      await deleteBlobUrls(urls)
      done.add(r.id)
    } catch (err) {
      console.error("[board-flyers] could not delete flyer files for post", r.id, (err as Error)?.message)
    }
  }
  return done
}

/** Clear the flyer columns of posts whose files were deleted. */
export async function clearFlyerColumns(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return
  await sql`
    UPDATE family_posts SET
      flyer_full_path = NULL, flyer_full_url = NULL, flyer_thumb_path = NULL, flyer_thumb_url = NULL,
      flyer_width = NULL, flyer_height = NULL, flyer_uploaded_at = NULL
    WHERE id = ANY(${postIds}::text[])
  `
}

/** Delete the files of every flyer in a family (family deleted). Rows stay for the purge. */
export async function removeFamilyFlyers(familyId: string): Promise<number> {
  await ensureBoardFlyerColumns()
  const rows = await sql`
    SELECT id, flyer_full_url, flyer_thumb_url FROM family_posts
    WHERE family_id = ${familyId} AND flyer_full_url IS NOT NULL
  `
  const done = await deleteFlyerFiles(rows as FlyerFileRow[])
  await clearFlyerColumns([...done])
  return done.size
}

/** Image URL served by our own authenticated route (never the raw blob URL). */
export function flyerImageUrl(familyId: string, postId: string, size: "thumb" | "full", uploadedAt: unknown): string {
  const v = uploadedAt ? new Date(uploadedAt as string).getTime() : 0
  return `/api/families/${familyId}/board/${postId}/flyer?size=${size}&v=${v}`
}

/** Live flyer posts in a family (for the per-family cap). */
export async function activeFlyerCount(familyId: string): Promise<number> {
  await ensureBoardFlyerColumns()
  const r = await sql`
    SELECT count(*)::int AS n FROM family_posts
    WHERE family_id = ${familyId} AND flyer_full_path IS NOT NULL AND deleted_at IS NULL
  `
  return Number(r[0]?.n ?? 0)
}

export const FLYER_LIMIT_MESSAGE = `Your board already has ${BOARD_FLYER.MAX_ACTIVE_PER_FAMILY} flyers. Remove an old one to pin a new one.`

/**
 * Validate an uploaded flyer from multipart form data: allowed type, size,
 * and that the bytes really are a JPEG/PNG/WebP image (not just the label).
 */
export async function readFlyerUpload(
  form: FormData
): Promise<{ input: Buffer } | { error: string; status: number }> {
  const file = form.get("file")
  if (!file || typeof file === "string") return { error: "Choose a photo first", status: 400 }
  if (!(BOARD_FLYER.ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return { error: "Use a JPEG, PNG or WebP photo", status: 400 }
  }
  if (file.size > BOARD_FLYER.MAX_UPLOAD_BYTES) {
    return { error: `That photo is too large (max ${BOARD_FLYER.MAX_UPLOAD_BYTES / 1024 / 1024} MB)`, status: 400 }
  }
  const input = Buffer.from(await file.arrayBuffer())
  try {
    const meta = await sharp(input).metadata()
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
      return { error: "Use a JPEG, PNG or WebP photo", status: 400 }
    }
  } catch {
    return { error: "That file isn't a readable photo", status: 400 }
  }
  return { input }
}
