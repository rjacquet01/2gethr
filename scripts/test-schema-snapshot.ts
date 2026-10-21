// Usage: npx tsx --tsconfig tsconfig.json scripts/test-schema-snapshot.ts
// lib/schema-snapshot.ts: ddl`...` skips a schema statement only when the
// catalog snapshot proves it would do nothing, and runs everything else
// exactly as before. Fake database; no network.
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { ddl, isNoop, resetSchemaSnapshot } = await import("../lib/schema-snapshot")

  // Catalog: table events (id, title, category), table location_requests (id), index idx_events_cal.
  const catalog = [
    { rel: "events", kind: "r", col: "id" }, { rel: "events", kind: "r", col: "title" }, { rel: "events", kind: "r", col: "category" },
    { rel: "location_requests", kind: "r", col: "id" },
    { rel: "idx_events_cal", kind: "i", col: null },
  ]
  const ran: string[] = []
  let snapshotQueries = 0
  let catalogMode: "ok" | "empty" | "throw" = "ok"
  __setSqlForTests((async (strings: TemplateStringsArray) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.startsWith("SELECT c.relname AS rel")) {
      snapshotQueries++
      if (catalogMode === "throw") throw new Error("permission denied for pg_class")
      return catalogMode === "empty" ? [] : catalog
    }
    ran.push(q)
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0])

  const snap = { tables: new Set(["events", "location_requests"]), columns: new Map([["events", new Set(["id", "title", "category"])], ["location_requests", new Set(["id"])]]), indexes: new Set(["idx_events_cal"]) }

  console.log("what counts as a no-op")
  {
    const noop = [
      "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY)",
      '  CREATE TABLE IF NOT EXISTS "location_requests" (\n id TEXT\n)',
      "CREATE TABLE IF NOT EXISTS public.events (id TEXT)",
      "CREATE INDEX IF NOT EXISTS idx_events_cal ON events(calendar_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_events_cal ON events(calendar_id);",
      "ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT",
      "ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'GENERAL', ADD COLUMN IF NOT EXISTS title TEXT",
    ]
    for (const q of noop) assert.strictEqual(isNoop(q, snap), true, q)
    ok("existing tables, indexes and columns (incl. several ADD COLUMNs) are no-ops")

    const runs = [
      "CREATE TABLE IF NOT EXISTS new_table (id TEXT)",
      "CREATE INDEX IF NOT EXISTS idx_new ON events(title)",
      "ALTER TABLE events ADD COLUMN IF NOT EXISTS new_col TEXT",
      "ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT, ADD COLUMN IF NOT EXISTS new_col TEXT",
      "ALTER TABLE missing_table ADD COLUMN IF NOT EXISTS id TEXT",
      "ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT, ALTER COLUMN title DROP NOT NULL",
      "ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT, ADD CONSTRAINT x CHECK (true)",
      "ALTER TABLE events ADD COLUMN category TEXT",
      "ALTER TABLE location_requests DROP CONSTRAINT IF EXISTS location_requests_requester_user_id_fkey",
      "ALTER TABLE events RENAME COLUMN title TO name",
      "CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$ BEGIN END $$ LANGUAGE plpgsql",
      "UPDATE events SET category = 'GENERAL' WHERE category IS NULL",
      "INSERT INTO admin_roles (name) VALUES ('x') ON CONFLICT DO NOTHING",
    ]
    for (const q of runs) assert.strictEqual(isNoop(q, snap), false, q)
    ok("missing objects, mixed ALTERs, constraints, renames, functions and data changes always run")
  }

  console.log("ddl`...`")
  {
    resetSchemaSnapshot()
    ran.length = 0
    snapshotQueries = 0
    await ddl`CREATE TABLE IF NOT EXISTS events (id TEXT)`
    await ddl`ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT`
    await ddl`CREATE INDEX IF NOT EXISTS idx_events_cal ON events(calendar_id)`
    await ddl`ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_new TEXT`
    await ddl`ALTER TABLE events ADD COLUMN IF NOT EXISTS ${"category"} TEXT`
    assert.strictEqual(snapshotQueries, 1, "one catalog query per instance")
    assert.deepStrictEqual(ran, ["ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_new TEXT", "ALTER TABLE events ADD COLUMN IF NOT EXISTS ? TEXT"])
    ok("one snapshot query; existing objects skipped; missing ones and anything with values run")

    for (const mode of ["empty", "throw"] as const) {
      resetSchemaSnapshot()
      ran.length = 0
      catalogMode = mode
      await ddl`CREATE TABLE IF NOT EXISTS events (id TEXT)`
      await ddl`ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT`
      assert.strictEqual(ran.length, 2, mode)
    }
    catalogMode = "ok"
    ok("no usable snapshot (empty or failing catalog): every statement runs, as before")
  }

  console.log("the codebase")
  {
    // Every schema statement in lib/ and app/ goes through ddl, and every ddl
    // call is one of the three idempotent forms (so a skip can only ever
    // drop a no-op).
    const offenders: string[] = []
    const odd: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e.name) && !p.endsWith(path.join("lib", "schema-snapshot.ts"))) {
          const t = fs.readFileSync(p, "utf8")
          for (const m of t.matchAll(/\bsql`\s*(ALTER TABLE \S+ ADD COLUMN IF NOT EXISTS|CREATE TABLE IF NOT EXISTS|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS)/g)) offenders.push(`${p}: ${m[1]}`)
          for (const m of t.matchAll(/\bddl`\s*([A-Z ]{6,40})/g)) {
            if (!/^(ALTER TABLE|CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS)/.test(m[1])) odd.push(`${p}: ${m[1]}`)
          }
        }
      }
    }
    walk("lib")
    walk("app")
    assert.deepStrictEqual(offenders, [], "schema statements still on plain sql")
    assert.deepStrictEqual(odd, [], "ddl used for something other than idempotent schema statements")
    ok("every IF NOT EXISTS schema statement uses ddl, and ddl is used for nothing else")
  }

  console.log(`\n${passed} passed`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
