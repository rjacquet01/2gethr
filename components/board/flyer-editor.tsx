'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { BOARD_FLYER } from '@/lib/constants'

const CAPTION_MAX = 500
type Rect = { x: number; y: number; w: number; h: number } // 0..1 of the rotated image
type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; start: Rect }
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
const MIN = 0.12

/** Today as YYYY-MM-DD in the phone's own time zone (for the date picker's min). */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Decode a picked photo (phone rotation applied) and shrink it to CLIENT_MAX_PX. */
async function loadWorkCanvas(file: File): Promise<HTMLCanvasElement> {
  let source: CanvasImageSource & { width: number; height: number }
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
      img.src = url
    })
  }
  const scale = Math.min(1, BOARD_FLYER.CLIENT_MAX_PX / Math.max(source.width, source.height))
  const c = document.createElement('canvas')
  c.width = Math.round(source.width * scale)
  c.height = Math.round(source.height * scale)
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height)
  return c
}

function rotated(src: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  const q = ((quarterTurns % 4) + 4) % 4
  if (q === 0) return src
  const c = document.createElement('canvas')
  c.width = q % 2 ? src.height : src.width
  c.height = q % 2 ? src.width : src.height
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((q * Math.PI) / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

/** Auto levels: stretch the 1st..99th percentile of brightness to the full range. */
function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 16) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++
  const total = hist.reduce((a, b) => a + b, 0)
  let lo = 0, hi = 255, acc = 0
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.01) break }
  acc = 0
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.01) break }
  if (hi - lo < 12) return
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Pick-and-tidy step before a flyer is uploaded: rotate, crop with handles,
 * optional auto-brighten, caption. Produces a JPEG no larger than
 * CLIENT_MAX_PX on its long side.
 */
export function FlyerEditor({
  file,
  mode,
  canPinToTop,
  onCancel,
  onSubmit,
}: {
  file: File | null
  mode: 'new' | 'replace'
  canPinToTop: boolean
  onCancel: () => void
  /** expiresOn: YYYY-MM-DD to take it down after, or '' to leave it up */
  onSubmit: (jpeg: Blob, caption: string, pinned: boolean, expiresOn: string) => Promise<boolean>
}) {
  const [work, setWork] = useState<HTMLCanvasElement | null>(null)
  const [turns, setTurns] = useState(0)
  const [crop, setCrop] = useState<Rect>(FULL)
  const [bright, setBright] = useState(true)
  const [caption, setCaption] = useState('')
  const [pinned, setPinned] = useState(false)
  const [expiresOn, setExpiresOn] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    setWork(null); setTurns(0); setCrop(FULL); setCaption(''); setPinned(false); setExpiresOn(''); setBright(true)
    if (!file) return
    let live = true
    loadWorkCanvas(file)
      .then((c) => { if (live) setWork(c) })
      .catch(() => {
        toast.error("This photo can't be opened here. Try a JPEG or PNG, or take a new photo.")
        onCancel()
      })
    return () => { live = false }
  }, [file, onCancel])

  // Redraw the preview (rotation + brighten) whenever those change.
  useEffect(() => {
    const c = preview.current
    if (!c || !work) return
    const r = rotated(work, turns)
    const scale = Math.min(1, 720 / Math.max(r.width, r.height))
    c.width = Math.round(r.width * scale)
    c.height = Math.round(r.height * scale)
    const ctx = c.getContext('2d')!
    ctx.drawImage(r, 0, 0, c.width, c.height)
    if (bright) enhance(ctx, c.width, c.height)
  }, [work, turns, bright])

  const onPointerDown = (m: Drag['mode']) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { mode: m, startX: e.clientX, startY: e.clientY, start: crop }
  }
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    const b = box.current?.getBoundingClientRect()
    if (!d || !b) return
    const dx = (e.clientX - d.startX) / b.width
    const dy = (e.clientY - d.startY) / b.height
    const s = d.start
    let { x, y, w, h } = s
    if (d.mode === 'move') {
      x = Math.min(Math.max(0, s.x + dx), 1 - s.w)
      y = Math.min(Math.max(0, s.y + dy), 1 - s.h)
    } else {
      const left = d.mode === 'nw' || d.mode === 'sw'
      const top = d.mode === 'nw' || d.mode === 'ne'
      if (left) { x = Math.min(Math.max(0, s.x + dx), s.x + s.w - MIN); w = s.x + s.w - x }
      else w = Math.min(Math.max(MIN, s.w + dx), 1 - s.x)
      if (top) { y = Math.min(Math.max(0, s.y + dy), s.y + s.h - MIN); h = s.y + s.h - y }
      else h = Math.min(Math.max(MIN, s.h + dy), 1 - s.y)
    }
    setCrop({ x, y, w, h })
  }, [])
  const onPointerUp = () => { drag.current = null }

  const rotate = () => {
    setTurns((t) => t + 1)
    setCrop(FULL)
  }

  const submit = async () => {
    if (!work || busy) return
    setBusy(true)
    try {
      const r = rotated(work, turns)
      const sx = Math.round(crop.x * r.width), sy = Math.round(crop.y * r.height)
      const sw = Math.max(1, Math.round(crop.w * r.width)), sh = Math.max(1, Math.round(crop.h * r.height))
      const out = document.createElement('canvas')
      out.width = sw
      out.height = sh
      const ctx = out.getContext('2d')!
      ctx.drawImage(r, sx, sy, sw, sh, 0, 0, sw, sh)
      if (bright) enhance(ctx, sw, sh)
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.88))
      if (!blob) throw new Error('encode')
      await onSubmit(blob, caption.trim(), canPinToTop && pinned, expiresOn)
    } catch {
      toast.error('Could not prepare the photo')
    } finally {
      setBusy(false)
    }
  }

  const handle = (m: Drag['mode'], pos: string) => (
    <span
      role="presentation"
      onPointerDown={onPointerDown(m)}
      className={`absolute h-6 w-6 touch-none rounded-full border-2 border-white bg-primary shadow ${pos}`}
    />
  )

  return (
    <Dialog open={!!file} onOpenChange={(o) => { if (!o && !busy) onCancel() }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'new' ? 'Pin a flyer' : 'Replace photo'}</DialogTitle>
          <DialogDescription>Drag the corners to crop, then pin it to the board.</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center rounded-md bg-neutral-900/90 p-2">
          {!work ? (
            <div className="flex h-56 items-center justify-center"><Spinner className="h-6 w-6 text-white" /></div>
          ) : (
            <div
              ref={box}
              className="relative inline-block select-none touch-none"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <canvas ref={preview} className="block max-h-[50vh] max-w-full" aria-label="Flyer preview" />
              {/* shade outside the crop, then the crop box with handles */}
              <div
                className="absolute border-2 border-white"
                style={{
                  left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                }}
                onPointerDown={onPointerDown('move')}
              >
                {handle('nw', '-left-3 -top-3')}
                {handle('ne', '-right-3 -top-3')}
                {handle('sw', '-bottom-3 -left-3')}
                {handle('se', '-bottom-3 -right-3')}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={rotate} disabled={!work}>
            <RotateCw className="mr-1.5 h-4 w-4" /> Rotate
          </Button>
          <Button type="button" variant={bright ? 'secondary' : 'outline'} size="sm" aria-pressed={bright} onClick={() => setBright((b) => !b)} disabled={!work}>
            <Sparkles className="mr-1.5 h-4 w-4" /> Auto-brighten {bright ? 'on' : 'off'}
          </Button>
          {(crop.w < 1 || crop.h < 1) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setCrop(FULL)}>Reset crop</Button>
          )}
        </div>

        {mode === 'new' && (
          <div className="space-y-2">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
              placeholder="Add a note (optional)"
              rows={2}
              className="resize-none text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="flyer-expires-on" className="text-xs text-muted-foreground">
                Take this down after (optional)
              </label>
              <Input
                id="flyer-expires-on"
                type="date"
                min={todayLocal()}
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                className="h-8 w-auto text-sm"
              />
              {expiresOn && (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setExpiresOn('')}>Clear</Button>
              )}
            </div>
            {canPinToTop && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(v === true)} />
                Keep at the top of the board
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={!work || busy}>
            {busy ? <Spinner className="mr-1.5 h-4 w-4" /> : null}
            {mode === 'new' ? 'Pin to board' : 'Replace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
