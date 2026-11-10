'use client'

import { useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  COLOR_THEMES,
  COLOR_THEME_STORAGE_KEY,
  DEFAULT_COLOR_THEME,
  applyColorTheme,
  isColorTheme,
} from '@/lib/color-themes'

function savedTheme() {
  try {
    const id = localStorage.getItem(COLOR_THEME_STORAGE_KEY)
    return isColorTheme(id) ? id : DEFAULT_COLOR_THEME
  } catch {
    return DEFAULT_COLOR_THEME
  }
}

// The theme on the page now (also right when storage is blocked).
function shownTheme() {
  return document.documentElement.getAttribute('data-palette') ?? DEFAULT_COLOR_THEME
}

// Picks up a change from another tab, or from choose() below.
const CHANGE_EVENT = 'togethr-color-theme-change'
function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== COLOR_THEME_STORAGE_KEY) return
    applyColorTheme(savedTheme())
    onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

// Settings > Preferences: pick a colour theme. Saved on this device only.
export function ColorThemePicker() {
  // null on the server, so nothing shows as picked until the page is in the browser.
  const current = useSyncExternalStore(subscribe, shownTheme, () => null)

  const choose = (id: string) => {
    applyColorTheme(id)
    try {
      if (id === DEFAULT_COLOR_THEME) localStorage.removeItem(COLOR_THEME_STORAGE_KEY)
      else localStorage.setItem(COLOR_THEME_STORAGE_KEY, id)
    } catch {
      // Private browsing: the theme still applies until the page is closed.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }

  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
      {COLOR_THEMES.map((t) => {
        const selected = current === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(t.id)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'border-primary bg-muted font-medium' : 'border-border'
            )}
          >
            <span className="relative flex h-8 w-8 overflow-hidden rounded-full border border-border" aria-hidden>
              <span className="h-full w-1/2" style={{ background: t.swatch[0] }} />
              <span className="h-full w-1/2" style={{ background: t.swatch[1] }} />
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Check className="h-4 w-4 text-white drop-shadow" />
                </span>
              )}
            </span>
            {t.name}
          </button>
        )
      })}
    </div>
  )
}
