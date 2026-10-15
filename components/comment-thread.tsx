'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { MemberAvatar } from '@/components/member-avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ThreadComment {
  id: string
  userId: string
  body: string
  createdAt: string
  updatedAt?: string | null
  authorName: string
  avatarUrl: string | null
  color: string | null
  emoji: string | null
  /** set on an optimistic row until the server confirms it */
  pending?: boolean
}

interface ThreadPage {
  data: ThreadComment[]
  hasMore: boolean
}

const fetchPage = async (url: string): Promise<ThreadPage> => {
  const res = await authFetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to load comments')
  return { data: json.data || [], hasMore: !!json.hasMore }
}

export const relativeTime = (iso: string) => {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

/**
 * Comments for one item, newest at the bottom. `baseUrl` serves:
 *   GET  baseUrl            -> { data: ThreadComment[], hasMore }  (latest 50)
 *   POST baseUrl { body }   -> creates a comment
 *   DELETE baseUrl/{id}     -> removes one (author, or a moderator)
 *   PATCH baseUrl { commentId, content }  (only when `editable`)
 * Refreshes every 30s while the tab is visible (SWR pauses when hidden) and
 * when the window regains focus.
 */
export function CommentThread({
  baseUrl,
  currentUserId,
  canModerate = false,
  editable = false,
  maxLength = 500,
  placeholder = 'Add a comment...',
}: {
  baseUrl: string
  currentUserId?: string | null
  canModerate?: boolean
  editable?: boolean
  maxLength?: number
  placeholder?: string
}) {
  const { data, error, isLoading, mutate } = useSWR<ThreadPage>(baseUrl, fetchPage, {
    refreshInterval: 30_000,
    refreshWhenHidden: false,
    revalidateOnFocus: true,
  })
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const comments = data?.data || []

  const post = async () => {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    const optimistic: ThreadComment = {
      id: `pending-${Date.now()}`,
      userId: currentUserId || '',
      body,
      createdAt: new Date().toISOString(),
      authorName: 'You',
      avatarUrl: null,
      color: null,
      emoji: null,
      pending: true,
    }
    setDraft('')
    try {
      await mutate(
        async (current) => {
          const res = await authFetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json.error || 'Could not post comment')
          return current
        },
        {
          optimisticData: (current) => ({ data: [...(current?.data || []), optimistic], hasMore: current?.hasMore || false }),
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        }
      )
    } catch (err) {
      setDraft(body)
      toast.error(err instanceof Error ? err.message : 'Could not post comment')
    } finally {
      setPosting(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await mutate(
        async (current) => {
          const res = await authFetch(`${baseUrl}/${id}`, { method: 'DELETE' })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json.error || 'Could not delete comment')
          return current
        },
        {
          optimisticData: (current) => ({ data: (current?.data || []).filter((c) => c.id !== id), hasMore: current?.hasMore || false }),
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        }
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete comment')
    }
  }

  const saveEdit = async (id: string) => {
    const content = editText.trim()
    if (!content) return
    const res = await authFetch(baseUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId: id, content }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(json.error || 'Could not update comment')
      return
    }
    setEditingId(null)
    mutate()
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="flex justify-center py-4"><Spinner className="h-4 w-4" /></div>
      ) : error ? (
        <p className="text-sm text-muted-foreground">Comments couldn&apos;t be loaded.</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => {
            const mine = !!currentUserId && c.userId === currentUserId
            const canDelete = !c.pending && (mine || canModerate)
            const canEdit = editable && mine && !c.pending
            return (
              <li key={c.id} className={`flex gap-2.5 rounded-xl bg-muted/50 p-2.5 ${c.pending ? 'opacity-60' : ''}`}>
                <MemberAvatar name={c.authorName} avatarUrl={c.avatarUrl} color={c.color} emoji={c.emoji} className="h-8 w-8 text-xs" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{c.authorName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.pending ? 'Sending...' : relativeTime(c.createdAt)}
                      {c.updatedAt && c.updatedAt !== c.createdAt && !c.pending ? ' (edited)' : ''}
                    </span>
                    {(canDelete || canEdit) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" aria-label="Comment options">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEdit && (
                            <DropdownMenuItem onClick={() => { setEditingId(c.id); setEditText(c.body) }}>
                              <Pencil className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <DropdownMenuItem className="text-destructive" onClick={() => remove(c.id)}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {editingId === c.id ? (
                    <div className="mt-1 space-y-2">
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} className="text-sm" />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(c.id)} disabled={!editText.trim()}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          post()
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              post()
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="min-h-9 flex-1 resize-none text-sm"
        />
        <Button type="submit" size="sm" disabled={posting || !draft.trim()}>
          {posting ? <Spinner className="h-4 w-4" /> : 'Post'}
        </Button>
      </form>
      {draft.length > maxLength * 0.8 && (
        <p className="text-right text-xs text-muted-foreground">{draft.length}/{maxLength}</p>
      )}
    </div>
  )
}
