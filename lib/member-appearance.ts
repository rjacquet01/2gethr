import { sql } from "./db"
import { ddl } from "./schema-snapshot"

// Per-member avatar customization (color + emoji). Added lazily because the
// production database is not migrated by hand.
let ensured: Promise<void> | null = null

export function ensureMemberAppearanceColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE family_members ADD COLUMN IF NOT EXISTS color TEXT`
      await ddl`ALTER TABLE family_members ADD COLUMN IF NOT EXISTS emoji TEXT`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#0EA5E9']
const DEFAULT_EMOJIS = ['😀', '😎', '🥳', '🤩', '😺', '🐶', '🦊', '🐼', '🦁', '🐸', '🦄', '🚀', '⚽', '🎮', '🎨', '🌈', '⭐', '🍕']

// Give a newly created child a random color + emoji (only if none is set yet)
// so profiles don't all start out looking the same. Never throws.
export async function assignDefaultAppearance(memberId: string): Promise<void> {
  try {
    await ensureMemberAppearanceColumns()
    const color = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]
    const emoji = DEFAULT_EMOJIS[Math.floor(Math.random() * DEFAULT_EMOJIS.length)]
    await sql`
      UPDATE family_members SET color = ${color}, emoji = ${emoji}
      WHERE id = ${memberId} AND color IS NULL AND emoji IS NULL
    `
  } catch (err) {
    console.warn("assignDefaultAppearance failed:", err)
  }
}
