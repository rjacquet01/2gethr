'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { StartOwnFamilyButton, useCanStartOwnFamily } from '@/components/start-own-family'

// Shown to guest members who open a family-only area (Location, Places)
// directly. The page renders this instead of calling the APIs, which would
// refuse a guest anyway.
export function GuestAreaNotice() {
  const canStartOwn = useCanStartOwnFamily()
  return (
    <Empty
      icon={Lock}
      title="This area is for family members"
      description="As a guest you can use the family calendar and tasks."
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link href="/calendar">Calendar</Link>
        </Button>
        <Button asChild>
          <Link href="/tasks">Tasks</Link>
        </Button>
      </div>
      {canStartOwn && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Want your own family? Start one without a new account. You&apos;ll stay in this one too.
          </p>
          <StartOwnFamilyButton />
        </div>
      )}
    </Empty>
  )
}
