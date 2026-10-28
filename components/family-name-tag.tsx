import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'

// Which family you're viewing, under a page title (Home, Tasks, ...). A small
// pill in the primary colour, like the New Task button: navy in light mode,
// orange in dark mode.
export function FamilyNameTag({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return null
  return (
    <span
      title="The family you're viewing"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-sm font-semibold text-primary-foreground',
        className
      )}
    >
      <Users className="h-3.5 w-3.5 shrink-0 text-primary-foreground/80" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  )
}
