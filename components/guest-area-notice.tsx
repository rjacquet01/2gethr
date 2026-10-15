'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'

// Shown to guest members who open a family-only area (Location, Places)
// directly. The page renders this instead of calling the APIs, which would
// refuse a guest anyway.
export function GuestAreaNotice() {
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
    </Empty>
  )
}
