'use client'

import { useFamilies } from '@/hooks/use-family'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Check, ChevronsUpDown, Users } from 'lucide-react'

// Lets a person who belongs to more than one family choose which one the
// Calendar, Tasks, Family, Location and Places pages show. Renders nothing
// for people in a single family. `variant="sidebar"` is the wide desktop
// version; `variant="compact"` is the icon-sized mobile header version.
export function FamilySwitcher({ variant = 'sidebar' }: { variant?: 'sidebar' | 'compact' }) {
  const { families, selectedFamilyId, selectFamily } = useFamilies()

  if (families.length < 2) return null

  const current = families.find((f) => f.id === selectedFamilyId) || families[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'compact' ? (
          <Button variant="ghost" size="sm" aria-label="Switch family" className="h-10 gap-1 px-2 max-w-[120px]">
            <Users className="h-4 w-4 shrink-0" />
            <span className="truncate text-xs">{current.name}</span>
          </Button>
        ) : (
          <button
            aria-label="Switch family"
            className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border px-3 py-2 text-left text-sm hover:bg-sidebar-accent transition-colors"
          >
            <Users className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
            <span className="flex-1 truncate font-medium text-sidebar-foreground">{current.name}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Your families</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {families.map((family) => (
          <DropdownMenuItem key={family.id} onClick={() => selectFamily(family.id)}>
            <span className="flex-1 truncate">{family.name}</span>
            {family.id === current.id && <Check className="ml-2 h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
