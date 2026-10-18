import { NextResponse } from "next/server"
import { sql } from "./db"
import { getMemberAccess, guestForbidden } from "./permissions"
import { authorInfo, notifySocial, type AuthorInfo } from "./social"
import { canPinFlyers, flyerImageUrl } from "./board-flyers"

export interface BoardAccess {
  role: string
  /** PARENT or the family owner: may pin and delete anyone's posts/comments */
  canModerate: boolean
  /** PARENT / GUARDIAN / ADULT: may pin photo flyers (kids post notes only) */
  canPinFlyers: boolean
  /** The same adults: may set Keep up and see / restore taken-down pins */
  canManagePins: boolean
}

/** Non-guest active members only. Returns the access or the response to send. */
export async function boardAccess(familyId: string, userId: string): Promise<BoardAccess | NextResponse> {
  const access = await getMemberAccess(familyId, userId)
  if (!access) return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
  if (access.isGuest) return guestForbidden()
  return { role: access.role, canModerate: access.isParent || access.isOwner, canPinFlyers: canPinFlyers(access.role), canManagePins: canPinFlyers(access.role) }
}

const FALLBACK_AUTHOR: AuthorInfo = { authorName: "Family member", avatarUrl: null, color: null, emoji: null }

export function shapeComment(r: Record<string, unknown>, authors: Map<string, AuthorInfo>) {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    body: r.body as string,
    createdAt: r.created_at,
    updatedAt: (r.updated_at ?? r.created_at) as unknown,
    ...(authors.get(r.user_id as string) || FALLBACK_AUTHOR),
  }
}

/**
 * Comment counts and the latest 2 comments for a page of posts (at most ~30
 * post ids), each using idx_family_post_comments_post.
 */
export async function shapePosts(familyId: string, posts: Record<string, unknown>[]) {
  const ids = posts.map((p) => p.id as string)
  const counts = new Map<string, number>()
  let latest: Record<string, unknown>[] = []
  if (ids.length > 0) {
    const c = await sql`
      SELECT post_id, COUNT(*)::int AS n FROM family_post_comments
      WHERE post_id = ANY(${ids}::text[]) AND deleted_at IS NULL
      GROUP BY post_id
    `
    for (const r of c) counts.set(r.post_id as string, r.n as number)
    latest = await sql`
      SELECT id, post_id, user_id, body, created_at FROM (
        SELECT id, post_id, user_id, body, created_at,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY created_at DESC) AS rn
        FROM family_post_comments
        WHERE post_id = ANY(${ids}::text[]) AND deleted_at IS NULL
      ) x WHERE rn <= 2
      ORDER BY created_at ASC
    `
  }
  const authors = await authorInfo(familyId, [
    ...posts.map((p) => p.user_id as string),
    ...latest.map((c) => c.user_id as string),
  ])
  return posts.map((p) => ({
    ...shapeComment(p, authors),
    pinned: p.pinned === true,
    keepUp: p.keep_up === true,
    expiresAt: (p.expires_at as unknown) ?? null,
    // Images are served by our own family-checked route, never by blob URL.
    flyer: p.flyer_thumb_path
      ? {
          thumbUrl: flyerImageUrl(familyId, p.id as string, "thumb", p.flyer_uploaded_at),
          fullUrl: flyerImageUrl(familyId, p.id as string, "full", p.flyer_uploaded_at),
          width: (p.flyer_width as number | null) ?? null,
          height: (p.flyer_height as number | null) ?? null,
        }
      : null,
    commentCount: counts.get(p.id as string) || 0,
    latestComments: latest.filter((c) => c.post_id === p.id).map((c) => shapeComment(c, authors)),
  }))
}

/**
 * Tell the other non-guest members about a new post: in-app always; push only
 * for pinned posts or posts from a PARENT, at most one board push per person
 * per 10 minutes.
 */
export async function notifyNewPost(opts: {
  familyId: string
  postId: string
  user: { id: string; firstName?: string | null; lastName?: string | null }
  role: string
  pinned: boolean
  body: string
  flyer?: boolean
}) {
  const recipients = await sql`
    SELECT user_id FROM family_members
    WHERE family_id = ${opts.familyId} AND is_active = true AND user_id IS NOT NULL
      AND role <> 'GUEST' AND user_id <> ${opts.user.id}
  `
  const name = opts.user.firstName ? `${opts.user.firstName} ${opts.user.lastName || ""}`.trim() : "Someone"
  await notifySocial({
    recipientIds: recipients.map((r) => r.user_id as string),
    type: "SYSTEM",
    title: opts.flyer
      ? `${name} pinned a flyer`
      : opts.pinned
        ? `${name} pinned a post`
        : `${name} posted on the family board`,
    body: (opts.body || (opts.flyer ? "New flyer on the family board" : "")).slice(0, 140),
    data: { subType: "BOARD_POST", postId: opts.postId, familyId: opts.familyId },
    push: opts.pinned || opts.role === "PARENT",
    scope: `board:${opts.familyId}`,
    clickAction: "/board",
  })
}
