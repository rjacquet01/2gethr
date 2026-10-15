'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { toast } from 'sonner'
import { MessagesSquare, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react'
import { authFetch, useAuth } from '@/hooks/use-auth'
import { useMyRole } from '@/hooks/use-my-role'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Empty } from '@/components/ui/empty'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MemberAvatar } from '@/components/member-avatar'
import { GuestAreaNotice } from '@/components/guest-area-notice'
import { CommentThread, relativeTime, type ThreadComment } from '@/components/comment-thread'

const POST_MAX = 500
const POLL_MS = 45_000

interface BoardPost extends ThreadComment {
  pinned: boolean
  commentCount: number
  latestComments: ThreadComment[]
}

interface BoardPage {
  pinned: BoardPost[]
  posts: BoardPost[]
  hasMore: boolean
  nextBefore: string | null
  canModerate: boolean
}

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await authFetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to load the board')
  return json.data as T
}

export default function BoardPage() {
  const { isGuest, isLoading, familyId } = useMyRole()
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }
  // Guests don't get the board (the server refuses it too).
  if (isGuest) return <GuestAreaNotice />
  if (!familyId) return <Empty title="No family yet" description="Create or join a family to use the board" />
  return <FamilyBoard familyId={familyId} />
}

function FamilyBoard({ familyId }: { familyId: string }) {
  const { user } = useAuth()
  const base = `/api/families/${familyId}/board`

  // Pages: the first has pinned posts too; later pages follow ?before=.
  const { data, size, setSize, isLoading, mutate } = useSWRInfinite<BoardPage>(
    (index, prev: BoardPage | null) => {
      if (index === 0) return base
      if (!prev?.nextBefore) return null
      return `${base}?before=${encodeURIComponent(prev.nextBefore)}`
    },
    fetchJson,
    { revalidateFirstPage: false, revalidateOnFocus: true }
  )
  const first = data?.[0]
  const pinned = first?.pinned || []
  const posts = useMemo(() => (data || []).flatMap((p) => p.posts), [data])
  const canModerate = !!first?.canModerate
  const newest = useMemo(() => {
    const all = [...pinned, ...posts].map((p) => p.createdAt)
    return all.length ? all.reduce((a, b) => (a > b ? a : b)) : null
  }, [pinned, posts])

  // Cheap poll while the tab is visible: only asks for posts newer than the
  // newest one we have, so a quiet board returns an empty list.
  const { data: fresh } = useSWR<{ posts: BoardPost[] }>(
    newest ? `${base}?since=${encodeURIComponent(newest)}` : null,
    fetchJson,
    { refreshInterval: POLL_MS, refreshWhenHidden: false, revalidateOnFocus: true }
  )
  useEffect(() => {
    if (fresh && fresh.posts.length > 0) mutate()
  }, [fresh, mutate])

  // Opening the board (and seeing new posts arrive) clears the unread count.
  const lastSeenFor = useRef<string | null>(null)
  useEffect(() => {
    if (!first || lastSeenFor.current === newest) return
    lastSeenFor.current = newest
    authFetch(`${base}/seen`, { method: 'POST' }).catch(() => {})
  }, [first, newest, base])

  const [draft, setDraft] = useState('')
  const [pinIt, setPinIt] = useState(false)
  const [posting, setPosting] = useState(false)

  const submit = async () => {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      const res = await authFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, pinned: canModerate && pinIt }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not post')
        return
      }
      setDraft('')
      setPinIt(false)
      mutate()
    } finally {
      setPosting(false)
    }
  }

  const removePost = async (id: string) => {
    const res = await authFetch(`${base}/${id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error || 'Could not delete post')
    else {
      toast.success('Post deleted')
      mutate()
    }
  }

  const setPinned = async (id: string, value: boolean) => {
    const res = await authFetch(`${base}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: value }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error || 'Could not update post')
    else {
      toast.success(value ? 'Post pinned' : 'Post unpinned')
      mutate()
    }
  }

  const lastPage = data?.[data.length - 1]
  const loadingMore = size > 0 && data && typeof data[size - 1] === 'undefined'

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 lg:pb-0">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">Family board</h1>
        <p className="text-sm text-muted-foreground">Short notes for the whole family.</p>
      </div>

      {/* Post box */}
      <Card className="py-0">
        <CardContent className="space-y-2 p-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, POST_MAX))}
            placeholder="Share something with the family..."
            rows={2}
            className="resize-none text-sm"
          />
          <div className="flex flex-wrap items-center gap-3">
            {canModerate && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={pinIt} onCheckedChange={(v) => setPinIt(v === true)} />
                Pin to top
              </label>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{draft.length}/{POST_MAX}</span>
            <Button size="sm" onClick={submit} disabled={posting || !draft.trim()}>
              {posting ? <Spinner className="mr-1.5 h-4 w-4" /> : null}
              Post
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : pinned.length === 0 && posts.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <Empty icon={MessagesSquare} title="Nothing here yet" description="Be the first to post something." />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...pinned, ...posts].map((p) => (
            <PostCard
              key={p.id}
              post={p}
              familyId={familyId}
              currentUserId={user?.id}
              canModerate={canModerate}
              onDelete={() => removePost(p.id)}
              onPin={(v) => setPinned(p.id, v)}
            />
          ))}
          {lastPage?.hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setSize(size + 1)} disabled={!!loadingMore}>
                {loadingMore ? <Spinner className="mr-1.5 h-4 w-4" /> : null}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PostCard({
  post,
  familyId,
  currentUserId,
  canModerate,
  onDelete,
  onPin,
}: {
  post: BoardPost
  familyId: string
  currentUserId?: string | null
  canModerate: boolean
  onDelete: () => void
  onPin: (pinned: boolean) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const mine = !!currentUserId && post.userId === currentUserId
  const canDelete = mine || canModerate

  return (
    <Card className={`py-0 ${post.pinned ? 'border-primary/50 bg-primary/5' : ''}`}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start gap-2.5">
          <MemberAvatar name={post.authorName} avatarUrl={post.avatarUrl} color={post.color} emoji={post.emoji} className="h-9 w-9 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{post.authorName}</span>
              {post.pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(post.createdAt)}</span>
              {(canDelete || canModerate) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" aria-label="Post options">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canModerate && (
                      <DropdownMenuItem onClick={() => onPin(!post.pinned)}>
                        {post.pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                        {post.pinned ? 'Unpin' : 'Pin to top'}
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{post.body}</p>
          </div>
        </div>

        {showAll ? (
          <div className="border-t pt-3">
            <CommentThread
              baseUrl={`/api/families/${familyId}/board/${post.id}/comments`}
              currentUserId={currentUserId}
              canModerate={canModerate}
              maxLength={300}
              placeholder="Write a comment..."
            />
          </div>
        ) : (
          <div className="space-y-2 border-t pt-2">
            {post.latestComments.map((c) => (
              <div key={c.id} className="flex gap-2">
                <MemberAvatar name={c.authorName} avatarUrl={c.avatarUrl} color={c.color} emoji={c.emoji} className="h-6 w-6 text-[10px]" />
                <p className="min-w-0 text-sm">
                  <span className="font-medium">{c.authorName}</span>{' '}
                  <span className="break-words">{c.body}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">{relativeTime(c.createdAt)}</span>
                </p>
              </div>
            ))}
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setShowAll(true)}>
              {post.commentCount > post.latestComments.length
                ? `View all ${post.commentCount} comments`
                : post.commentCount > 0
                  ? 'Reply'
                  : 'Comment'}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
