import { sql } from "./db"

// The lazy schema setup (the ensure*() functions) runs dozens of
// "CREATE ... IF NOT EXISTS" / "ADD COLUMN IF NOT EXISTS" statements the
// first time each server instance needs them, one round trip each, even
// though in production everything already exists. ddl`...` runs such a
// statement only when the object is missing, checked against one catalog
// snapshot loaded once per instance. Anything it can't prove is a no-op
// runs exactly as before.

interface Snapshot {
  tables: Set<string>
  columns: Map<string, Set<string>>
  indexes: Set<string>
}

let snapshot: Promise<Snapshot | null> | null = null

function loadSnapshot(): Promise<Snapshot | null> {
  if (!snapshot) {
    snapshot = (async () => {
      try {
        const rows = await sql`
          SELECT c.relname AS rel, c.relkind AS kind, a.attname AS col
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'i')
        `
        const s: Snapshot = { tables: new Set(), columns: new Map(), indexes: new Set() }
        for (const r of rows) {
          const rel = String(r.rel)
          if (r.kind === "i") {
            s.indexes.add(rel)
          } else {
            s.tables.add(rel)
            if (r.col) {
              if (!s.columns.has(rel)) s.columns.set(rel, new Set())
              s.columns.get(rel)!.add(String(r.col))
            }
          }
        }
        // An empty answer (e.g. a test's fake database) proves nothing.
        return s.tables.size > 0 ? s : null
      } catch {
        return null
      }
    })()
  }
  return snapshot
}

const ident = String.raw`"?([A-Za-z_][A-Za-z0-9_]*)"?`
const CREATE_TABLE = new RegExp(String.raw`^CREATE TABLE IF NOT EXISTS (?:public\.)?${ident}`, "i")
const CREATE_INDEX = new RegExp(String.raw`^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ${ident}`, "i")
const ALTER_TABLE = new RegExp(String.raw`^ALTER TABLE (?:ONLY )?(?:public\.)?${ident}\s+([\s\S]*)$`, "i")
const ADD_COLUMN = new RegExp(String.raw`ADD COLUMN IF NOT EXISTS ${ident}`, "gi")
// Anything an ALTER might do besides adding columns: never skipped.
const OTHER_ALTER = /\b(ALTER\s+COLUMN|DROP|RENAME|ADD\s+CONSTRAINT|ADD\s+(PRIMARY|UNIQUE|FOREIGN|CHECK)|SET\b|VALIDATE|OWNER|ENABLE|DISABLE|INHERIT|ATTACH|DETACH)/i

/** Is this statement a no-op given the snapshot? (Exported for tests.) */
export function isNoop(text: string, s: Snapshot): boolean {
  const q = text.trim().replace(/;\s*$/, "")
  let m = CREATE_TABLE.exec(q)
  if (m) return s.tables.has(m[1])
  m = CREATE_INDEX.exec(q)
  if (m) return s.indexes.has(m[1])
  m = ALTER_TABLE.exec(q)
  if (m) {
    const [, table, rest] = m
    if (OTHER_ALTER.test(rest)) return false
    const cols = [...rest.matchAll(ADD_COLUMN)].map((x) => x[1])
    // Every clause must be an ADD COLUMN IF NOT EXISTS we can check.
    if (cols.length === 0 || (rest.match(/\bADD\b/gi) || []).length !== cols.length) return false
    const have = s.columns.get(table)
    return !!have && cols.every((c) => have.has(c))
  }
  return false
}

/**
 * Run an idempotent schema statement only if what it creates is missing.
 * Same call shape as sql`...`; statements with interpolated values, or of
 * any other kind, always run.
 */
export async function ddl(strings: TemplateStringsArray, ...values: unknown[]) {
  if (values.length === 0) {
    const s = await loadSnapshot()
    if (s && isNoop(strings.join(""), s)) return []
  }
  return sql(strings, ...values)
}

/** Forget the snapshot (tests). */
export function resetSchemaSnapshot(): void {
  snapshot = null
}
