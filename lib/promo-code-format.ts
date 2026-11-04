// The shape of a promo code, on its own so browser code (components/
// source-capture.tsx) can check one without loading lib/promo-codes.ts.

/** "launch 20" -> "LAUNCH20"; null unless 3-30 letters, digits, - or _. */
export function normalizePromoCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const code = value.trim().toUpperCase().replace(/\s+/g, "")
  return /^[A-Z0-9_-]{3,30}$/.test(code) ? code : null
}
