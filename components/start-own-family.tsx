'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useFamilies } from '@/hooks/use-family'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Someone invited into another family (often as a guest) can start a family
 * of their own from the same account and keep the invited membership. Only
 * for people who own no family yet (one owned family per account) and who
 * aren't a child member; the server enforces the same rules.
 */
export function useCanStartOwnFamily() {
  const { user } = useAuth()
  const { families } = useFamilies()
  if (!user || families.length === 0) return false
  const roleIn = (f: (typeof families)[number]) => f.currentUserRole || f.userRole
  const ownsOne = families.some((f) => f.ownerId === user.id)
  const allChild = families.every((f) => roleIn(f) === 'CHILD')
  const childHere = roleIn(families[0]) === 'CHILD'
  return !ownsOne && !allChild && !childHere
}

export function CreateOwnFamilyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { createFamily, selectFamily } = useFamilies()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    const result = await createFamily(name.trim())
    setSaving(false)
    if (!result.success) {
      toast.error(result.error || 'Could not create the family')
      return
    }
    // Switch to the new family; the invited one stays in the switcher.
    if (result.family?.id) selectFamily(result.family.id)
    toast.success(result.message || 'Family created')
    setName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Start your own family</DialogTitle>
          <DialogDescription>
            Uses your current account. You&apos;ll stay in the families you&apos;ve joined and can switch between them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="own-family-name">Family name</Label>
          <Input
            id="own-family-name"
            value={name}
            maxLength={100}
            placeholder="e.g. The Rivera Family"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Not now
          </Button>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving && <Spinner className="mr-2 h-4 w-4" />}
            Create family
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Start my own family" button + dialog; renders nothing for people who can't. */
export function StartOwnFamilyButton({
  variant = 'outline',
  size = 'sm',
  className,
}: {
  variant?: 'outline' | 'default' | 'secondary' | 'ghost'
  size?: 'sm' | 'default'
  className?: string
}) {
  const canStart = useCanStartOwnFamily()
  const [open, setOpen] = useState(false)
  if (!canStart) return null
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Start my own family
      </Button>
      <CreateOwnFamilyDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
