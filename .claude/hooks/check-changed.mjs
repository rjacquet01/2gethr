#!/usr/bin/env node
// PostToolUse hook for Edit/Write: after a .ts/.tsx file changes, runs the
// incremental type check (about 7 s) and ESLint (errors only) and hands any
// errors IN THAT FILE back to Claude as context. Never blocks: always exits
// 0. Plain Node so it works on Windows.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

let input = {}
try {
  input = JSON.parse(fs.readFileSync(0, "utf8") || "{}")
} catch {
  process.exit(0)
}
const file = String(input?.tool_input?.file_path ?? input?.tool_response?.filePath ?? "")
if (!/\.(ts|tsx)$/i.test(file) || !fs.existsSync(file)) process.exit(0)

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
const rel = path.relative(projectDir, path.resolve(file))
if (rel.startsWith("..") || path.isAbsolute(rel) || /(^|[\\/])(node_modules|\.next)[\\/]/.test(rel)) process.exit(0)
const relPosix = rel.split(path.sep).join("/")

const run = (script, args) =>
  fs.existsSync(script)
    ? spawnSync(process.execPath, [script, ...args], { cwd: projectDir, encoding: "utf8", timeout: 50_000 })
    : null

const report = []

// Type errors in the changed file (tsc checks the project; incremental keeps it quick).
const tsc = run(path.join(projectDir, "node_modules", "typescript", "bin", "tsc"), ["--noEmit", "--pretty", "false"])
if (tsc && tsc.status !== 0) {
  const lines = `${tsc.stdout || ""}`.split(/\r?\n/).filter((l) => l.replace(/\\/g, "/").startsWith(relPosix + "("))
  if (lines.length) report.push(`Type errors:\n${lines.slice(0, 30).join("\n")}`)
}

// ESLint errors (not warnings) in the changed file.
const eslint = run(path.join(projectDir, "node_modules", "eslint", "bin", "eslint.js"), ["--quiet", "--format", "stylish", rel])
if (eslint && eslint.status !== 0) {
  const out = `${eslint.stdout || ""}${eslint.stderr || ""}`.trim()
  if (out) report.push(`ESLint errors:\n${out.slice(0, 3000)}`)
}

if (report.length) {
  const text = `Checks on ${relPosix} after this edit (not blocking):\n${report.join("\n\n")}`
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }))
}
process.exit(0)
