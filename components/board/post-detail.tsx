'use client'

import { useState, type ReactNode } from 'react'
import { ImageMinus, Magnet, Pin, PinOff, RefreshCw, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MemberAvatar } from '@/components/member-avatar'
import { CommentThread, relativeTime } from '@/components/comment-thread'
import { flyerAlt, type BoardPost } from './types'

// Full view of one pinned item: the flyer at full size (tap to zoom), the
// text, who posted it and when, the replies and a reply box, plus actions.
export function PostDetail({
  post,
  familyId,
  currentUserId,
  canModerate,
  canPinFlyers,
  keepUp,
  onClose,
  onDelete,
  onPin,
  onReplacePhoto,
  onRemovePhoto,
  extra,
}: {
  post: BoardPost | null
  familyId: string
  currentUserId?: string | null
  canModerate: boolean
  canPinFlyers: boolean
  /** Adults only: the Keep up switch and how many are used. */
  keepUp?: { used: number; max: number; onChange: (post: BoardPost, value: boolean) => Promise<void> } | null
  onClose: () => void
  onDelete: (post: BoardPost) => void
  onPin: (post: BoardPost, pinned: boolean) => void
  onReplacePhoto: (post: BoardPost) => void
  onRemovePhoto: (post: BoardPost) => void
  /** Optional extra block under the flyer (e.g. add-ons). */
  extra?: (post: BoardPost) => ReactNode
}) {
  const [zoom, setZoom] = useState(false)
  const mine = !!post && !!currentUserId && post.userId === currentUserId
  const canDelete = mine || canModerate
  const canEditPhoto = !!post?.flyer && canPinFlyers && (mine || canModerate)

  return (
    <Dialog open={!!post} onOpenChange={(o) => { if (!o) { setZoom(false); onClose() } }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto p-4 sm:p-6">
        {post && (
          <>
            <DialogHeader className="text-left">
              <div className="flex items-center gap-2.5">
                <MemberAvatar name={post.authorName} avatarUrl={post.avatarUrl} color={post.color} emoji={post.emoji} className="h-9 w-9 text-sm" />
                <div className="min-w-0">
                  <DialogTitle className="truncate text-base">{post.flyer ? 'Flyer' : 'Note'} from {post.authorName}</DialogTitle>
                  <DialogDescription className="text-xs">
                    {relativeTime(post.createdAt)}
                    {post.pinned ? ' · kept at the top' : ''}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {post.flyer && (
              <div className="relative">
                <div className={`overflow-auto rounded-md bg-neutral-100 ${zoom ? 'max-h-[70vh]' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.flyer.fullUrl}
                    alt={flyerAlt(post)}
                    className={zoom ? 'block h-auto max-w-none' : 'block h-auto w-full'}
                    style={zoom ? { width: '200%' } : undefined}
                    onClick={() => setZoom((z) => !z)}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-2 top-2 h-8 w-8 shadow"
                  onClick={() => setZoom((z) => !z)}
                  aria-label={zoom ? 'Zoom out' : 'Zoom in'}
                >
                  {zoom ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
                </Button>
              </div>
            )}

            {post.body && <p className="whitespace-pre-wrap break-words text-sm">{post.body}</p>}

            {post.expiresAt && !post.keepUp && (
              <p className="text-xs text-muted-foreground">Comes down after {expiryLabel(post.expiresAt)}.</p>
            )}

            {extra?.(post)}

            {keepUp && <KeepUpRow post={post} {...keepUp} />}

            {(canModerate || canDelete || canEditPhoto) && (
              <div className="flex flex-wrap gap-2">
                {canModerate && (
                  <Button size="sm" variant="outline" onClick={() => onPin(post, !post.pinned)}>
                    {post.pinned ? <PinOff className="mr-1.5 h-4 w-4" /> : <Pin className="mr-1.5 h-4 w-4" />}
                    {post.pinned ? 'Unpin from top' : 'Keep at top'}
                  </Button>
                )}
                {canEditPhoto && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => onReplacePhoto(post)}>
                      <RefreshCw className="mr-1.5 h-4 w-4" /> Replace photo
                    </Button>
                    {post.body && (
                      <Button size="sm" variant="outline" onClick={() => onRemovePhoto(post)}>
                        <ImageMinus className="mr-1.5 h-4 w-4" /> Remove photo
                      </Button>
                    )}
                  </>
                )}
                {canDelete && (
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => onDelete(post)}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                  </Button>
                )}
              </div>
            )}

            <div className="border-t pt-3">
              <CommentThread
                baseUrl={`/api/families/${familyId}/board/${post.id}/comments`}
                currentUserId={currentUserId}
                canModerate={canModerate}
                maxLength={300}
                placeholder="Write a reply..."
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** expires_at is the start of the last day the flyer shows. */
function expiryLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function KeepUpRow({
  post,
  used,
  max,
  onChange,
}: {
  post: BoardPost
  used: number
  max: number
  onChange: (post: BoardPost, value: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const full = !post.keepUp && used >= max
  const id = `keep-up-${post.id}`
  return (
    <div className="flex items-start gap-3 rounded-md border bg-amber-50/60 p-3 dark:bg-amber-950/20">
      <Magnet className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm font-medium">Keep up</label>
        <p className="text-xs text-muted-foreground">
          {full
            ? `All ${max} are in use. Turn off Keep up on another pin first.`
            : `Never taken down to make room or after its date. ${used} of ${max} kept up.`}
        </p>
      </div>
      <Switch
        id={id}
        checked={post.keepUp}
        disabled={busy || full}
        onCheckedChange={async (v) => {
          setBusy(true)
          try { await onChange(post, v) } finally { setBusy(false) }
        }}
      />
    </div>
  )
}
