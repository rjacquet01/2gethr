// Deterministic "hand-pinned" look per post: derived from the post id so a
// card never jumps when the board re-renders.

function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// No yellow here: gold is reserved for kept-up pins (KEEP_UP_PIN).
export const PIN_COLORS = ['#d93636', '#2f6fd6', '#2e9e57', '#e8702a', '#8b4fd1'] as const

// Paper colors with dark text, readable in light and dark mode alike.
export const NOTE_COLORS = ['#fff3a3', '#ffd6e0', '#cdeefd', '#d6f5c9', '#ffe2b8'] as const

export function boardLook(id: string) {
  const h = hash(id)
  return {
    /** -3.0 .. +3.0 degrees */
    rotate: ((h % 61) - 30) / 10,
    /** small horizontal nudge in px, so columns don't look ruled */
    nudge: ((h >>> 8) % 9) - 4,
    pin: PIN_COLORS[(h >>> 4) % PIN_COLORS.length],
    note: NOTE_COLORS[(h >>> 12) % NOTE_COLORS.length],
    /** sticky notes sometimes use tape instead of a pin */
    tape: ((h >>> 16) % 4) === 0,
  }
}

/** Gold push pin for pins marked "Keep up" (not one of PIN_COLORS). */
export const KEEP_UP_PIN = '#c99a06'
