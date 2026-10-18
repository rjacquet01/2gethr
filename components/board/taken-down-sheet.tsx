'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Undo2 } from 'lucide-react'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { relativeTime } from '@/components/comment-thread'
import { boardLook } from './board-look'
import { rolledOffMessage, type RolledOff, type TakenDownPin } from './types'

const REASON: Record<TakenDownPin['reason'], string> = {
  roll_off: 'Taken down to make room',
  event_over: 'Event is over',
  manual: 'Taken down',
}

// Adults only: pins that came down in the last RESTORE_DAYS, with Restore.
// A restore on a full board takes down the oldest unprotected pin instead.
export function TakenDownSheet({
  familyId,
  open,
  restoreDays,
  onOpenChange,
  onRestored,
}: {
  familyId: string
  open: boolean
  restoreDays: number
  onOpenChange: (open: boolean) => void
  onRestored: () => void
}) {
  const url = `/api/families/${familyId}/board/taken-down`
  const { data, isLoading, mutate } = useSWR<{ pins: TakenDownPin[] }>(open ? url : null, async (u: string) => {
    const res = await authFetch(u)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Failed to load')
    return json.data
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  const restore = async (pin: TakenDownPin) => {
    setBusyId(pin.id)
    try {
      const res = await authFetch(`/api/families/${familyId}/board/${pin.id}/restore`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not restore it')
        mutate()
        return
      }
      const made = rolledOffMessage((json.rolledOff || []) as RolledOff[], restoreDays)
      toast.success(made ? `Restored. ${made}` : 'Back on the board')
      mutate()
      onRestored()
    } finally {
      setBusyId(null)
    }
  }

  const pins = data?.pins || []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Taken down</SheetTitle>
          <SheetDescription>
            Pins that came down in the last {restoreDays} days. After that they are deleted for good.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-6">
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : pins.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing has been taken down. When the board is full, the oldest pins come down here and can be put back.
            </p>
          ) : (
            pins.map((pin) => (
              <div key={pin.id} className="flex gap-3 rounded-md border p-3">
                {pin.flyer ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pin.flyer.thumbUrl}
                    alt={`Flyer posted by ${pin.authorName}`}
                    loading="lazy"
                    decoding="async"
                    width={pin.flyer.width ?? undefined}
                    height={pin.flyer.height ?? undefined}
                    className="h-20 w-16 shrink-0 rounded-sm bg-neutral-200 object-cover"
                  />
                ) : (
                  <div
                    className="h-20 w-16 shrink-0 overflow-hidden rounded-sm p-1.5 text-[10px] leading-tight text-neutral-900"
                    style={{ background: boardLook(pin.id).note }}
                    aria-hidden="true"
                  >
                    {pin.body}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {pin.body && <p className="line-clamp-2 break-words text-sm">{pin.body}</p>}
                  <p className="text-xs text-muted-foreground">
                    {pin.flyer ? 'Flyer' : 'Note'} from {pin.authorName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {REASON[pin.reason]} · {relativeTime(pin.takenDownAt)}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {pin.daysLeft <= 1 ? 'Last day to restore' : `${pin.daysLeft} days left to restore`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 self-center"
                  disabled={busyId !== null}
                  onClick={() => restore(pin)}
                  aria-label={`Restore ${pin.flyer ? 'flyer' : 'note'} from ${pin.authorName}`}
                >
                  {busyId === pin.id ? <Spinner className="mr-1.5 h-4 w-4" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
