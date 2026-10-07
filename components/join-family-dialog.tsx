'use client'

import { useState } from 'react'
import { mutate as globalMutate } from 'swr'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { authFetch } from '@/hooks/use-auth'
import { setSelectedFamilyId } from '@/hooks/use-family'
import { Users } from 'lucide-react'

// "Join another family" - for people who already belong to a family and have
// been given an invite code for a second one. On success the new family is
// selected, so the whole app switches to it straight away.
export function JoinFamilyButton({ variant = 'outline' }: { variant?: 'outline' | 'ghost' | 'default' }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)

  const handleJoin = async () => {
    const inviteCode = code.trim().toUpperCase()
    if (!inviteCode) {
      toast.error('Please enter an invite code')
      return
    }
    setJoining(true)
    try {
      const res = await authFetch('/api/families/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) {
        toast.error(data.error || 'Could not join that family')
        return
      }
      await globalMutate('/api/families')
      if (data.data?.familyId) setSelectedFamilyId(data.data.familyId)
      toast.success(`Joined ${data.data?.familyName || 'the family'}`)
      setCode('')
      setOpen(false)
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Users className="w-4 h-4 mr-2" />
          Join Another Family
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join another family</DialogTitle>
          <DialogDescription>
            Enter the invite code another family shared with you. You&apos;ll stay in your
            current family too, and can switch between them any time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="join-family-code">Invite code</Label>
          <Input
            id="join-family-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJoin()
            }}
            placeholder="Enter 8-character code"
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={joining}>
            Cancel
          </Button>
          <Button onClick={handleJoin} disabled={joining || !code.trim()}>
            {joining && <Spinner className="h-4 w-4 mr-2" />}
            Join Family
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
