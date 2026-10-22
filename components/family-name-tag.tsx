import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'

// Which family you're viewing, under a page title (Home, Tasks, ...). A soft
// pill in the brand's orange accent so the family's name stands out a little
// from the grey subtitles without competing with the page title.
export function FamilyNameTag({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return null
  return (
    <span
      title="The family you're viewing"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-sm font-semibold text-foreground ring-1 ring-inset ring-accent/30',
        className
      )}
    >
      <Users className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  )
}
