import { NextResponse } from "next/server"
import { sql } from "./db"
import { getMemberAccess, guestForbidden } from "./permissions"
import { authorInfo, type AuthorInfo } from "./social"

export interface BoardAccess {
  role: string
  /** PARENT or the family owner: may pin and delete anyone's posts/comments */
  canModerate: boolean
}

/** Non-guest active members only. Returns the access or the response to send. */
export async function boardAccess(familyId: string, userId: string): Promise<BoardAccess | NextResponse> {
  const access = await getMemberAccess(familyId, userId)
  if (!access) return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
  if (access.isGuest) return guestForbidden()
  return { role: access.role, canModerate: access.isParent || access.isOwner }
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
    commentCount: counts.get(p.id as string) || 0,
    latestComments: latest.filter((c) => c.post_id === p.id).map((c) => shapeComment(c, authors)),
  }))
}
