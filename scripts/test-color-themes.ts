// Usage: npx tsx --tsconfig tsconfig.json scripts/test-color-themes.ts
// Colour themes (Settings > Preferences, lib/color-themes.ts):
//  - every theme except the default has a light and a dark block in app/globals.css,
//    and both set the same tokens (a token set only in light would leak into dark);
//  - no stray blocks for themes that aren't in the list;
//  - the <head> script only applies known theme ids, and never throws.
// Pure: reads files, no database, no network.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { COLOR_THEMES, COLOR_THEME_SCRIPT, COLOR_THEME_STORAGE_KEY, DEFAULT_COLOR_THEME, isColorTheme } from "../lib/color-themes"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
const tokens = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `missing ${selector}`)
  const body = css.slice(start, css.indexOf("}", start))
  return [...body.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]).sort()
}

const ids = COLOR_THEMES.map((t) => t.id)
assert.strictEqual(new Set(ids).size, ids.length, "duplicate theme ids")
assert.ok(ids.includes(DEFAULT_COLOR_THEME))
for (const id of ids.filter((i) => i !== DEFAULT_COLOR_THEME)) {
  const light = tokens(`html[data-palette='${id}']`)
  const dark = tokens(`html.dark[data-palette='${id}']`)
  assert.deepStrictEqual(dark, light, `${id}: light and dark set different tokens`)
  for (const t of ["primary", "primary-foreground", "accent", "background", "foreground", "sidebar", "ring"]) {
    assert.ok(light.includes(t), `${id}: no --${t}`)
  }
}
ok(`${ids.length - 1} themes have matching light and dark token blocks`)

const inCss = [...css.matchAll(/data-palette='([a-z]+)'/g)].map((m) => m[1])
assert.deepStrictEqual([...new Set(inCss)].sort(), ids.filter((i) => i !== DEFAULT_COLOR_THEME).sort())
assert.ok(!css.includes(`data-palette='${DEFAULT_COLOR_THEME}'`))
ok("no CSS for unknown themes; the default uses the base tokens")

assert.ok(isColorTheme("forest") && !isColorTheme("evil") && !isColorTheme(null))
const runScript = (stored: string | null, throwOnRead = false) => {
  const attrs: Record<string, string> = {}
  const ctx = {
    localStorage: { getItem: (k: string) => { if (throwOnRead) throw new Error("blocked"); return k === COLOR_THEME_STORAGE_KEY ? stored : null } },
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } } },
  }
  vm.runInNewContext(COLOR_THEME_SCRIPT, ctx)
  return attrs["data-palette"] ?? null
}
assert.strictEqual(runScript("ocean"), "ocean")
assert.strictEqual(runScript(null), null)
assert.strictEqual(runScript(DEFAULT_COLOR_THEME), null)
assert.strictEqual(runScript("x' onload='alert(1)"), null)
assert.strictEqual(runScript("forest", true), null)
ok("head script: applies known themes only, ignores junk, survives blocked storage")

console.log(`\n${passed} checks passed`)
