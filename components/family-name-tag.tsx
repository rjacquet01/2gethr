import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'

// Which family you're viewing, under a page title (Home, Tasks, ...). A small
// pill in the side navigation's navy so the family's name stands out from the
// grey subtitles without competing with the page title.
export function FamilyNameTag({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return null
  return (
    <span
      title="The family you're viewing"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full bg-sidebar px-2.5 py-0.5 text-sm font-semibold text-sidebar-foreground ring-1 ring-inset ring-sidebar-border',
        className
      )}
    >
      <Users className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/80" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  )
}
