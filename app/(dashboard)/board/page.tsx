'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { toast } from 'sonner'
import { AlertTriangle, Archive, Camera, Images, StickyNote } from 'lucide-react'
import { authFetch, useAuth } from '@/hooks/use-auth'
import { useMyRole } from '@/hooks/use-my-role'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Empty } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { GuestAreaNotice } from '@/components/guest-area-notice'
import { BoardSurface } from '@/components/board/board-surface'
import { BoardItem } from '@/components/board/board-item'
import { PostDetail } from '@/components/board/post-detail'
import { FlyerEditor } from '@/components/board/flyer-editor'
import { TakenDownSheet } from '@/components/board/taken-down-sheet'
import { rolledOffMessage, type BoardPage, type BoardPost, type RolledOff } from '@/components/board/types'
import { BOARD_LIMITS } from '@/lib/constants'
import { DictateField } from '@/components/dictate-button'
import { appendDictation } from '@/lib/dictation'

const POST_MAX = 500
const POLL_MS = 45_000

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
  const pinned = useMemo(() => first?.pinned || [], [first])
  const posts = useMemo(() => (data || []).flatMap((p) => p.posts), [data])
  const canModerate = !!first?.canModerate
  const canPinFlyers = !!first?.canPinFlyers
  const canManagePins = !!first?.canManagePins
  const counts = first?.counts || null
  const all = useMemo(() => [...pinned, ...posts], [pinned, posts])
  const [takenDownOpen, setTakenDownOpen] = useState(false)

  // After a post or restore: say what came down to make room, if anything.
  const announceRolledOff = (rolledOff: RolledOff[] | undefined) => {
    const msg = rolledOffMessage(rolledOff || [], BOARD_LIMITS.RESTORE_DAYS)
    if (msg) toast(msg, { duration: 8000 })
  }
  const newest = useMemo(() => {
    const times = all.map((p) => p.createdAt as string)
    return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null
  }, [all])

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

  // --- detail view -------------------------------------------------------
  const [openId, setOpenId] = useState<string | null>(null)
  const openPost = all.find((p) => p.id === openId) || null

  // --- note composer -----------------------------------------------------
  const [noteOpen, setNoteOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pinIt, setPinIt] = useState(false)
  const [posting, setPosting] = useState(false)

  const submitNote = async () => {
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
      setNoteOpen(false)
      announceRolledOff(json.rolledOff)
      mutate()
    } finally {
      setPosting(false)
    }
  }

  // --- flyer capture -----------------------------------------------------
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [replaceFor, setReplaceFor] = useState<BoardPost | null>(null)

  const pickPhoto = (source: 'camera' | 'gallery', forPost: BoardPost | null) => {
    setReplaceFor(forPost)
    ;(source === 'camera' ? cameraInput : galleryInput).current?.click()
  }
  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    e.target.value = ''
    if (f) setPickedFile(f)
  }
  const closeEditor = useCallback(() => {
    setPickedFile(null)
    setReplaceFor(null)
  }, [])

  const uploadFlyer = async (jpeg: Blob, caption: string, pinTop: boolean, expiresOn: string): Promise<boolean> => {
    const form = new FormData()
    form.append('file', jpeg, 'flyer.jpg')
    const target = replaceFor
    if (!target) {
      if (caption) form.append('body', caption)
      if (pinTop) form.append('pinned', 'true')
      if (expiresOn) form.append('expiresOn', expiresOn)
    }
    const res = await authFetch(target ? `${base}/${target.id}/flyer` : `${base}/flyers`, {
      method: target ? 'PUT' : 'POST',
      body: form,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(json.error || (res.status === 413 ? 'That photo is too large' : 'Could not pin the flyer'))
      return false
    }
    toast.success(target ? 'Photo replaced' : 'Flyer pinned')
    announceRolledOff(json.rolledOff)
    closeEditor()
    mutate()
    return true
  }

  // --- post actions ------------------------------------------------------
  const removePost = async (post: BoardPost) => {
    if (!window.confirm(post.flyer ? 'Delete this flyer?' : 'Delete this note?')) return
    const res = await authFetch(`${base}/${post.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error || 'Could not delete post')
    else {
      toast.success('Deleted')
      setOpenId(null)
      mutate()
    }
  }

  const removePhoto = async (post: BoardPost) => {
    if (!window.confirm('Remove the photo and keep the note?')) return
    const res = await authFetch(`${base}/${post.id}/flyer`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error || 'Could not remove the photo')
    else {
      toast.success('Photo removed')
      if (json.data?.postRemoved) setOpenId(null)
      mutate()
    }
  }

  const setPinned = async (post: BoardPost, value: boolean) => {
    const res = await authFetch(`${base}/${post.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: value }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error || 'Could not update post')
    else {
      toast.success(value ? 'Kept at the top' : 'Unpinned from the top')
      mutate()
    }
  }

  const setKeepUp = async (post: BoardPost, value: boolean) => {
    const res = await authFetch(`${base}/${post.id}/keep-up`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepUp: value }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error || 'Could not update the pin')
    else toast.success(value ? 'This pin stays up' : 'Keep up turned off')
    mutate()
  }

  const pinCount = counts?.pins ?? all.length
  const almostFull = pinCount >= BOARD_LIMITS.WARN_AT

  const lastPage = data?.[data.length - 1]
  const loadingMore = size > 0 && data && typeof data[size - 1] === 'undefined'

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20 lg:pb-0">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-bold sm:text-2xl">Family board</h1>
          <p className="text-sm text-muted-foreground">
            Flyers and notes for the whole family.
            {counts && (
              <span className="ml-1.5 whitespace-nowrap font-medium text-foreground">
                · {pinCount} of {BOARD_LIMITS.MAX_PINS} pins
              </span>
            )}
          </p>
        </div>
        {canManagePins && (
          <Button variant="ghost" onClick={() => setTakenDownOpen(true)}>
            <Archive className="mr-1.5 h-4 w-4" /> Taken down{counts?.takenDown ? ` (${counts.takenDown})` : ''}
          </Button>
        )}
        <Button variant="outline" onClick={() => setNoteOpen(true)}>
          <StickyNote className="mr-1.5 h-4 w-4" /> Write a note
        </Button>
        {canPinFlyers && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Camera className="mr-1.5 h-4 w-4" /> Pin a flyer
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => pickPhoto('camera', null)}>
                <Camera className="mr-2 h-4 w-4" /> Take a photo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => pickPhoto('gallery', null)}>
                <Images className="mr-2 h-4 w-4" /> Choose from gallery
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {almostFull && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Board is almost full. The oldest pins will come down.
        </p>
      )}

      {/* Hidden pickers: one opens the camera, the other the gallery. */}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPicked} />
      <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={onPicked} />

      <BoardSurface>
        {isLoading ? (
          <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="mb-5 h-36 w-full rounded-sm bg-white/50" />)}
          </div>
        ) : all.length === 0 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
            <div className="rotate-[-2deg] rounded-[2px] bg-[#fff3a3] px-5 py-4 text-neutral-800 shadow-[0_8px_14px_-6px_rgba(0,0,0,0.35)]">
              <p className="font-medium">The board is empty</p>
              <p className="mt-1 text-sm">
                {canPinFlyers ? 'Pin a school flyer or write a note for everyone.' : 'Write a note for everyone.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
            {all.map((p) => <BoardItem key={p.id} post={p} onOpen={() => setOpenId(p.id)} />)}
          </div>
        )}
        {lastPage?.hasMore && (
          <div className="mt-2 flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => setSize(size + 1)} disabled={!!loadingMore}>
              {loadingMore ? <Spinner className="mr-1.5 h-4 w-4" /> : null}
              Load more
            </Button>
          </div>
        )}
      </BoardSurface>

      <PostDetail
        post={openPost}
        familyId={familyId}
        currentUserId={user?.id}
        canModerate={canModerate}
        canPinFlyers={canPinFlyers}
        keepUp={canManagePins ? { used: counts?.keptUp ?? 0, max: BOARD_LIMITS.MAX_KEEP_UP, onChange: setKeepUp } : null}
        onClose={() => setOpenId(null)}
        onDelete={removePost}
        onPin={setPinned}
        onReplacePhoto={(p) => pickPhoto('gallery', p)}
        onRemovePhoto={removePhoto}
      />

      <FlyerEditor
        file={pickedFile}
        mode={replaceFor ? 'replace' : 'new'}
        canPinToTop={canModerate}
        onCancel={closeEditor}
        onSubmit={uploadFlyer}
      />

      {canManagePins && (
        <TakenDownSheet
          familyId={familyId}
          open={takenDownOpen}
          restoreDays={BOARD_LIMITS.RESTORE_DAYS}
          onOpenChange={setTakenDownOpen}
          onRestored={() => mutate()}
        />
      )}

      {/* Note composer */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Write a note</DialogTitle>
            <DialogDescription>It goes up on the board for the whole family.</DialogDescription>
          </DialogHeader>
          <DictateField multiline label="Dictate the note" onText={(t) => setDraft((v) => appendDictation(v, t).slice(0, POST_MAX))}>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, POST_MAX))}
              placeholder="Share something with the family..."
              rows={4}
              className="resize-none text-sm pr-11"
              autoFocus
            />
          </DictateField>
          <div className="flex items-center gap-3">
            {canModerate && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={pinIt} onCheckedChange={(v) => setPinIt(v === true)} />
                Keep at the top
              </label>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{draft.length}/{POST_MAX}</span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button onClick={submitNote} disabled={posting || !draft.trim()}>
              {posting ? <Spinner className="mr-1.5 h-4 w-4" /> : null}
              Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
