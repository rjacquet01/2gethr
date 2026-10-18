import type { ThreadComment } from '@/components/comment-thread'

export interface BoardFlyer {
  thumbUrl: string
  fullUrl: string
  width: number | null
  height: number | null
}

export interface BoardPost extends ThreadComment {
  pinned: boolean
  commentCount: number
  latestComments: ThreadComment[]
  flyer: BoardFlyer | null
}

export interface BoardPage {
  pinned: BoardPost[]
  posts: BoardPost[]
  hasMore: boolean
  nextBefore: string | null
  canModerate: boolean
  canPinFlyers: boolean
}

/** Alt text for a flyer image. */
export function flyerAlt(post: BoardPost): string {
  return `Flyer posted by ${post.authorName}`
}
