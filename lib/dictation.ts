// Voice input (components/dictate-button.tsx): the browser turns speech into
// text (Chrome/Edge through Google, Safari through Apple); Togethr only ever
// receives the text, and only when the user saves the form.

/**
 * Joins the pieces a listening session heard, in order. Android Chrome often
 * repeats what it already sent (each piece is the whole phrase so far), so a
 * piece that starts with the text so far replaces it, and one already at the
 * end of it is skipped.
 */
export function joinHeard(pieces: string[]): string {
  let text = ""
  for (const raw of pieces) {
    const p = (raw || "").replace(/\s+/g, " ").trim()
    if (!p) continue
    const t = text.toLowerCase()
    const q = p.toLowerCase()
    if (!text || q.startsWith(t)) text = p
    else if (!t.endsWith(q)) text = `${text} ${p}`
  }
  return text
}

/** Adds dictated words to what is already in the box: a space between, a capital to start a sentence. */
export function appendDictation(current: string, spoken: string): string {
  const words = spoken.replace(/\s+/g, " ").trim()
  if (!words) return current
  const before = current.replace(/\s+$/, "")
  const startsSentence = before === "" || /[.!?]$/.test(before)
  const text = startsSentence ? words.charAt(0).toUpperCase() + words.slice(1) : words
  return before ? `${before} ${text}` : text
}
