// Voice input (components/dictate-button.tsx): the browser turns speech into
// text (Chrome/Edge through Google, Safari through Apple); Togethr only ever
// receives the text, and only when the user saves the form.

/** Adds dictated words to what is already in the box: a space between, a capital to start a sentence. */
export function appendDictation(current: string, spoken: string): string {
  const words = spoken.replace(/\s+/g, " ").trim()
  if (!words) return current
  const before = current.replace(/\s+$/, "")
  const startsSentence = before === "" || /[.!?]$/.test(before)
  const text = startsSentence ? words.charAt(0).toUpperCase() + words.slice(1) : words
  return before ? `${before} ${text}` : text
}
