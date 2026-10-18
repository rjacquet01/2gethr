'use client'

import { MessageCircle, Pin } from 'lucide-react'
import { relativeTime } from '@/components/comment-thread'
import { boardLook } from './board-look'
import { PushPin, Tape } from './push-pin'
import { flyerAlt, type BoardPost } from './types'

// One thing pinned to the board: a paper flyer (photo) or a sticky note.
// Tapping it opens the detail view.
export function BoardItem({ post, onOpen }: { post: BoardPost; onOpen: () => void }) {
  const look = boardLook(post.id)
  const replies = post.commentCount
  const label = post.flyer
    ? `${flyerAlt(post)}${post.body ? `: ${post.body.slice(0, 80)}` : ''}`
    : `Note from ${post.authorName}: ${post.body.slice(0, 80)}`

  return (
    <div
      className="relative mb-5 break-inside-avoid pt-2"
      // A slight tilt and nudge per post, same every render.
      style={{ transform: `translateX(${look.nudge}px) rotate(${look.rotate}deg)` }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${label}. ${replies} ${replies === 1 ? 'reply' : 'replies'}. Open`}
        className="group relative block w-full text-left outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-[3px] motion-safe:transition-transform motion-safe:duration-150 motion-safe:hover:-translate-y-0.5"
      >
        {/* pin or tape, centered on the top edge */}
        <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
          {!post.flyer && look.tape ? <Tape className="rotate-[-4deg]" /> : <PushPin color={look.pin} />}
        </span>

        {post.flyer ? (
          <div
            className="rounded-[3px] bg-[#fbfaf6] p-1.5 pb-2 text-neutral-900"
            style={{ boxShadow: '0 1px 1px rgba(0,0,0,0.15), 0 6px 14px rgba(0,0,0,0.28)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.flyer.thumbUrl}
              alt={flyerAlt(post)}
              loading="lazy"
              decoding="async"
              width={post.flyer.width ?? undefined}
              height={post.flyer.height ?? undefined}
              className="block h-auto w-full rounded-[2px] bg-neutral-200"
              style={post.flyer.width && post.flyer.height ? { aspectRatio: `${post.flyer.width} / ${post.flyer.height}` } : undefined}
            />
            {post.body && <p className="mt-1.5 line-clamp-2 px-0.5 text-xs leading-snug">{post.body}</p>}
            <Meta post={post} />
          </div>
        ) : (
          <div
            className="min-h-[7rem] rounded-[2px] p-3 pt-4 text-neutral-900"
            style={{ background: look.note, boxShadow: '0 1px 1px rgba(0,0,0,0.12), 0 8px 14px -6px rgba(0,0,0,0.35)' }}
          >
            <p className="line-clamp-[8] whitespace-pre-wrap break-words text-sm leading-snug">{post.body}</p>
            <Meta post={post} />
          </div>
        )}
      </button>
    </div>
  )
}

function Meta({ post }: { post: BoardPost }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 px-0.5 text-[11px] text-neutral-700">
      {post.pinned && (
        <span className="inline-flex items-center gap-0.5 font-semibold text-red-700">
          <Pin className="h-3 w-3" aria-hidden="true" />
          Top
        </span>
      )}
      <span className="min-w-0 truncate font-medium">{post.authorName}</span>
      <span className="shrink-0">· {relativeTime(post.createdAt)}</span>
      {post.commentCount > 0 && (
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-black/10 px-1.5 py-0.5 font-medium">
          <MessageCircle className="h-3 w-3" aria-hidden="true" />
          {post.commentCount}
        </span>
      )}
    </div>
  )
}
