// Colour themes (Settings > Preferences). Free for everyone, saved on the
// device like dark mode. Each one is a block of colour tokens in
// app/globals.css (html[data-palette='<id>']), in light and dark; Togethr is
// the default and sets no attribute. The swatches are the theme's light
// primary and accent.

export interface ColorTheme {
  id: string
  name: string
  swatch: [string, string]
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'togethr', name: 'Togethr', swatch: ['oklch(0.35 0.08 260)', 'oklch(0.72 0.16 55)'] },
  { id: 'forest', name: 'Forest', swatch: ['oklch(0.42 0.09 155)', 'oklch(0.76 0.14 85)'] },
  { id: 'ocean', name: 'Ocean', swatch: ['oklch(0.44 0.1 230)', 'oklch(0.74 0.12 190)'] },
  { id: 'berry', name: 'Berry', swatch: ['oklch(0.42 0.13 345)', 'oklch(0.7 0.16 10)'] },
  { id: 'sunset', name: 'Sunset', swatch: ['oklch(0.5 0.16 35)', 'oklch(0.78 0.14 70)'] },
  { id: 'honey', name: 'Honey', swatch: ['oklch(0.42 0.07 60)', 'oklch(0.8 0.15 85)'] },
  { id: 'lavender', name: 'Lavender', swatch: ['oklch(0.45 0.14 295)', 'oklch(0.76 0.11 320)'] },
  { id: 'graphite', name: 'Graphite', swatch: ['oklch(0.3 0.01 250)', 'oklch(0.72 0.03 250)'] },
]

export const DEFAULT_COLOR_THEME = 'togethr'
export const COLOR_THEME_STORAGE_KEY = 'togethr-color-theme'

export function isColorTheme(id: unknown): id is string {
  return typeof id === 'string' && COLOR_THEMES.some((t) => t.id === id)
}

/** Sets the theme on <html>; the default removes the attribute. */
export function applyColorTheme(id: string) {
  const root = document.documentElement
  if (id === DEFAULT_COLOR_THEME || !isColorTheme(id)) root.removeAttribute('data-palette')
  else root.setAttribute('data-palette', id)
}

/** Runs in <head> before the page paints, so a saved theme doesn't flash navy first. */
export const COLOR_THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(COLOR_THEME_STORAGE_KEY)});if(t&&t!==${JSON.stringify(DEFAULT_COLOR_THEME)}&&${JSON.stringify(COLOR_THEMES.map((t) => t.id))}.indexOf(t)>-1)document.documentElement.setAttribute('data-palette',t)}catch(e){}`
