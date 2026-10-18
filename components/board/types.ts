import type { ThreadComment } from '@/components/comment-thread'

export interface BoardFlyer {
  thumbUrl: string
  fullUrl: string
  width: number | null
  height: number | null
}

export interface BoardPost extends ThreadComment {
  pinned: boolean
  /** "Keep up": never rolls off or comes down after its date */
  keepUp: boolean
  /** an event flyer comes down the day after this */
  expiresAt: string | null
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
  canManagePins: boolean
  /** page one only */
  counts: { pins: number; flyers: number; keptUp: number; takenDown: number | null } | null
}

export interface RolledOff {
  id: string
  title: string
}

export interface TakenDownPin {
  id: string
  userId: string
  authorName: string
  body: string
  createdAt: string
  takenDownAt: string
  reason: 'roll_off' | 'event_over' | 'manual'
  restoreUntil: string
  daysLeft: number
  flyer: { thumbUrl: string; width: number | null; height: number | null } | null
}

/** Toast text after a post or restore made room on the board. */
export function rolledOffMessage(rolledOff: RolledOff[], restoreDays: number): string | null {
  if (rolledOff.length === 0) return null
  const first = `'${rolledOff[0].title}'`
  const what = rolledOff.length === 1 ? `${first} was` : `${first} and ${rolledOff.length - 1} more were`
  return `${what} taken down to make room. You can restore ${rolledOff.length === 1 ? 'it' : 'them'} from Taken down for ${restoreDays} days.`
}

/** Alt text for a flyer image. */
export function flyerAlt(post: BoardPost): string {
  return `Flyer posted by ${post.authorName}`
}
