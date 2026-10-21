'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// Edit your own "Name shown to this family" (your nickname in this family).
// Blank uses your account first name from Settings.
export function FamilyNameButton({
  familyId, familyName, nickname, accountFirstName, onSaved,
}: {
  familyId: string
  familyName: string
  nickname: string
  accountFirstName: string
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(nickname)
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await authFetch(`/api/families/${familyId}/my-name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not save your name')
        return
      }
      toast.success('Name updated')
      setOpen(false)
      onSaved()
    } catch {
      toast.error('Could not save your name')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => { setValue(nickname); setOpen(true) }}
        aria-label="Edit the name shown to this family"
      >
        <Pencil className="w-4 h-4 sm:mr-1" />
        <span className="hidden sm:inline">Name</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Name shown to this family</DialogTitle>
              <DialogDescription>
                What everyone in {familyName} sees on the family list, map, tasks and alerts. Leave it blank to use
                your account name{accountFirstName ? ` (${accountFirstName})` : ''}, which you change in Settings.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="family-name">Name shown to this family</Label>
              <Input
                id="family-name"
                value={value}
                maxLength={50}
                placeholder={accountFirstName || 'Your name'}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Spinner className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
