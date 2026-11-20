'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useFamilies } from '@/hooks/use-family'
import { useAuth } from '@/hooks/use-auth'

// Shown on the dashboard to someone with no family yet, for example a new
// sign-up who skipped onboarding with "I'll do this later". Several new
// accounts got stuck on a bare "No family yet / Get Started" page, so this
// puts the one step that matters (naming a family, which also starts the free
// 30-day Premium trial) right here, with the name already filled in.
export function CreateFamilyCard() {
  const { createFamily } = useFamilies()
  const { user } = useAuth()
  const first = (user?.displayName || '').trim().split(/\s+/)[0]
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const value = name ?? (first ? `${first}'s Family` : 'My Family')

  const create = async () => {
    if (!value.trim()) {
      toast.error('Please enter a family name')
      return
    }
    setBusy(true)
    const result = await createFamily(value.trim())
    setBusy(false)
    if (result.success) toast.success('Family created. Your free 30-day Premium trial has started.')
    else toast.error(result.error || 'Failed to create family')
  }

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md items-center">
      <Card className="w-full border-primary/40 shadow-lg">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Set up your family to get started</h2>
              <p className="text-sm text-muted-foreground">
                One step, and your free 30-day Premium trial starts. No card needed.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-family-name">Family name</Label>
            <Input
              id="create-family-name"
              value={value}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void create() }}
              className="h-11"
            />
          </div>
          <Button className="w-full" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create my family'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Have an invite code from a family member?{' '}
            <Link href="/onboarding" className="font-medium text-primary hover:underline">Join with a code</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
