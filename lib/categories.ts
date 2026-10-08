// Shared helpers for task / event categories. Built-in categories have fixed
// values and colors; anything else is a user-defined ("custom") category that
// is stored as free text and gets a stable color derived from its name.

export const CUSTOM_CATEGORY_MAX_LENGTH = 30

export const CUSTOM_COLOR_POOL = [
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-amber-500',
  'bg-lime-600',
  'bg-rose-500',
  'bg-sky-500',
  'bg-fuchsia-500',
] as const

/** Trim, collapse whitespace and cap the length of a user-typed category. */
export function cleanCustomCategory(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_CATEGORY_MAX_LENGTH)
}

/** Human-readable label: "SELF_CARE" / "piano lessons" -> "Self Care" / "Piano Lessons". */
export function formatCategory(value?: string | null): string {
  if (!value) return ''
  const v = value.trim()
  if (v === v.toUpperCase() || v === v.toLowerCase()) {
    return v
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return v
}

/** Deterministic Tailwind background class for a category with no built-in color. */
export function customCategoryColor(value?: string | null): string {
  const key = (value || '').trim().toLowerCase()
  if (!key) return 'bg-gray-500'
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return CUSTOM_COLOR_POOL[hash % CUSTOM_COLOR_POOL.length]
}

export function isBuiltInCategory(
  value: string | null | undefined,
  options: { value: string }[],
): boolean {
  if (!value) return false
  return options.some((o) => o.value.toLowerCase() === value.toLowerCase())
}
