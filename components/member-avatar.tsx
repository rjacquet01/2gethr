'use client'

import { useState } from 'react'
import { Palette } from 'lucide-react'
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
  return (
    <Avatar className={cn('w-10 h-10', className)}>
      <AvatarImage src={avatarUrl ? `/api/files?pathname=${encodeURIComponent(avatarUrl)}` : undefined} />
      <AvatarFallback
        className={cn(!color && 'bg-primary/10 text-primary', color && 'text-white font-semibold')}
        style={color ? { backgroundColor: color } : undefined}
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

  const openDialog = (ev: React.MouseEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    setC(color || null)
    setE(emoji || null)
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
        title="Customize color & emoji"
        aria-label="Customize color and emoji"
        onClick={openDialog}
      >
        <Palette className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={(ev) => ev.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Customize {name || 'avatar'}</DialogTitle>
            <DialogDescription>Pick a color and an emoji. Photos, if set, still take priority.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <MemberAvatar name={name} avatarUrl={null} color={c} emoji={e} className="w-20 h-20 text-3xl" />
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
