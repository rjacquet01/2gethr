'use client'

import { useRef, useState } from 'react'
import { Palette, Camera, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { mutate as globalMutate } from 'swr'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ColorPicker } from '@/components/customization'
import { authFetch } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

export const AVATAR_EMOJIS = [
  '😀', '😎', '🥳', '🤩', '😺', '🐶', '🐱', '🦊', '🐼', '🐯', '🦁', '🐸',
  '🐵', '🦄', '🐢', '🦋', '🐙', '🦖', '🚀', '⚽', '🏀', '🎮', '🎨', '🎸',
  '📚', '🌈', '⭐', '🔥', '🌻', '🍕', '🍦', '👑',
]

// Friendly colors used when nobody has picked one yet, so avatars are never
// the same flat grey/blue. Chosen deterministically from the name.
const DEFAULT_AVATAR_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#0EA5E9', '#D946EF',
]

export function defaultColorFor(name?: string | null) {
  const str = name || '?'
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return DEFAULT_AVATAR_COLORS[h % DEFAULT_AVATAR_COLORS.length]
}

// Shrink big phone photos before upload (max 512px, JPEG) so they are fast and
// always under the 5MB server limit.
async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const max = 512
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return file
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function initialsOf(name?: string | null) {
  return (name || '').split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

interface MemberAvatarProps {
  name?: string | null
  avatarUrl?: string | null
  color?: string | null
  emoji?: string | null
  className?: string
}

/** Avatar that shows the photo if there is one, otherwise the chosen emoji/color. */
export function MemberAvatar({ name, avatarUrl, color, emoji, className }: MemberAvatarProps) {
  const bg = color || defaultColorFor(name)
  return (
    <Avatar className={cn('w-10 h-10', className)}>
      <AvatarImage src={avatarUrl ? `/api/files?pathname=${encodeURIComponent(avatarUrl)}` : undefined} />
      <AvatarFallback
        className="text-white font-semibold"
        style={{ backgroundColor: bg }}
      >
        {emoji ? <span className="text-[1.15em] leading-none">{emoji}</span> : initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

interface AppearanceButtonProps {
  familyId: string
  memberId: string
  name?: string | null
  avatarUrl?: string | null
  color?: string | null
  emoji?: string | null
}

/** Small palette button that opens the "customize look" dialog. */
export function AppearanceButton({ familyId, memberId, name, avatarUrl, color, emoji }: AppearanceButtonProps) {
  const [open, setOpen] = useState(false)
  const [c, setC] = useState<string | null>(color || null)
  const [e, setE] = useState<string | null>(emoji || null)
  const [saving, setSaving] = useState(false)
  const [photo, setPhoto] = useState<string | null>(avatarUrl || null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const onPickPhoto = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const picked = ev.target.files?.[0]
    ev.target.value = ''
    if (!picked) return
    setPhotoBusy(true)
    try {
      const file = await downscaleImage(picked)
      const fd = new FormData()
      fd.append('file', file)
      const res = await authFetch(`/api/families/${familyId}/members/${memberId}/photo`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to upload photo')
      setPhoto(data.data?.pathname || null)
      toast.success('Photo updated')
      globalMutate(() => true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = async () => {
    setPhotoBusy(true)
    try {
      const res = await authFetch(`/api/families/${familyId}/members/${memberId}/photo`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to remove photo')
      setPhoto(null)
      toast.success('Photo removed')
      globalMutate(() => true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove photo')
    } finally {
      setPhotoBusy(false)
    }
  }

  const openDialog = (ev: React.MouseEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    setC(color || null)
    setE(emoji || null)
    setPhoto(avatarUrl || null)
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await authFetch(`/api/families/${familyId}/members/${memberId}/appearance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: c, emoji: e }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      toast.success('Look updated')
      setOpen(false)
      globalMutate(() => true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    // Stop clicks (including ones from the dialog portal) from reaching a parent link/button.
    <span className="contents" onClick={(ev) => ev.stopPropagation()}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        title="Customize photo, color & emoji"
        aria-label="Customize photo, color and emoji"
        onClick={openDialog}
      >
        <Palette className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={(ev) => ev.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Customize {name || 'avatar'}</DialogTitle>
            <DialogDescription>Add a photo, or pick a color and an emoji. A photo, if set, shows instead of the emoji.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <MemberAvatar name={name} avatarUrl={photo} color={c} emoji={e} className="w-24 h-24 text-3xl" />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onPickPhoto} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                {photoBusy ? <Spinner className="mr-2" /> : <Camera className="mr-2 h-4 w-4" />}
                {photo ? 'Change photo' : 'Add photo'}
              </Button>
              {photo && (
                <Button type="button" variant="ghost" size="sm" disabled={photoBusy} onClick={removePhoto}>
                  <Trash2 className="mr-2 h-4 w-4" />Remove
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Color</p>
              <ColorPicker value={c} onChange={setC} onClear={() => setC(null)} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Emoji</p>
              <div className="grid grid-cols-8 gap-1.5 rounded-lg border border-border p-2">
                <button
                  type="button"
                  onClick={() => setE(null)}
                  className={cn('aspect-square rounded-lg border text-[10px] font-medium', !e ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted')}
                >
                  ABC
                </button>
                {AVATAR_EMOJIS.map((x) => (
                  <button
                    key={x}
                    type="button"
                    onClick={() => setE(x)}
                    className={cn('aspect-square rounded-lg border text-xl', e === x ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted')}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Spinner className="mr-2" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  )
}
