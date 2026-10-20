'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CloudSun, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  dismissWeatherPrompt,
  isWeatherPromptDismissed,
  weatherPromptFor,
  type WeatherStatus,
} from '@/lib/weather-prompt'

// Calendar weather needs a saved place; sign-up collects no address, so new
// families see no weather without knowing why. Shown only when places loaded
// and there are none - never while loading, on an error, or to guests.
export function WeatherSetupPrompt({
  status,
  role,
  familyId,
}: {
  status: WeatherStatus
  role: string | null | undefined
  familyId: string | null | undefined
}) {
  // Dismissing only hides the banner, never the weather. Storage is read only
  // once the banner would show (client side, after places load).
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const kind = weatherPromptFor(status, role)
  if (!kind || !familyId || dismissedFor === familyId || isWeatherPromptDismissed(familyId)) return null

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-foreground"
    >
      <CloudSun className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1">
        {kind === 'add'
          ? 'Add a Home place to see weather on your calendar.'
          : 'Ask a parent to add a Home place to see weather.'}
      </p>
      {kind === 'add' && (
        <Button asChild size="sm" variant="outline" className="h-8 shrink-0 px-3">
          <Link href="/places">Add Home</Link>
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground"
        aria-label="Dismiss weather tip"
        onClick={() => {
          dismissWeatherPrompt(familyId)
          setDismissedFor(familyId)
        }}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}
