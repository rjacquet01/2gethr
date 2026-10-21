#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell: blocks (exit 2, reason on stderr)
//   - reading or printing .env files (cat/type/grep/sed/Get-Content/... on
//     .env*, readFileSync of .env*, --env-file=.env which is production)
//   - recursive force deletes outside node_modules and .next
//   - git push --force / -f / --force-with-lease / +refspec
//   - anything naming the production database host from .env (read here at
//     hook time; never written anywhere)
// Everything else passes. Plain Node so it works on Windows.
import fs from "node:fs"
import path from "node:path"

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

let input = {}
try {
  input = JSON.parse(readStdin() || "{}")
} catch {
  process.exit(0) // not our business if the payload is unreadable
}
const command = String(input?.tool_input?.command ?? "")
if (!command) process.exit(0)

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

/** The production DB endpoint id (e.g. "ep-xxx") from .env, or null. Never printed. */
function productionDbMarker() {
  try {
    const text = fs.readFileSync(path.join(projectDir, ".env"), "utf8")
    const m = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
    if (!m) return null
    const host = new URL(m[1].trim()).hostname // ep-abc-123-pooler.region.aws.neon.tech
    const first = host.split(".")[0].replace(/-pooler$/, "")
    return first.length >= 6 ? first.toLowerCase() : host.toLowerCase()
  } catch {
    return null
  }
}

const block = (reason) => {
  process.stderr.write(`Blocked by .claude/hooks/guard-shell.mjs: ${reason}\n`)
  process.exit(2)
}

// --- .env files: reading or printing them -------------------------------------
const ENV_FILE = String.raw`(?:^|[\s"'=/\\(:])\.env(?:\.[A-Za-z0-9_.-]+)?(?=$|[\s"';|&)<>,])`
const READERS = String.raw`\b(cat|type|more|less|head|tail|bat|nl|od|xxd|hexdump|strings|grep|egrep|fgrep|rg|ag|findstr|sed|awk|gawk|cut|sort|uniq|tee|cp|copy|mv|scp|rsync|curl|wget|base64|openssl|source|Get-Content|gc|Select-String|sls|Copy-Item|cpi|Import-Csv|ConvertFrom-StringData)\b`
if (new RegExp(READERS + String.raw`[^|;&]*` + ENV_FILE, "i").test(command) || /(^|[;&|]\s*)\.\s+["']?(?:\.[\\/])?\.env(?:\.[A-Za-z0-9_.-]+)?(?=$|["'\s;|&])/i.test(command)) {
  block("it reads or prints a .env file. Secrets stay out of the shell and the transcript.")
}
if (/readFileSync\s*\(\s*[^)]*\.env\b/i.test(command) || /\bopen\s*\(\s*[^)]*\.env\b/i.test(command)) {
  block("it reads a .env file from an inline script.")
}
// --env-file=.env is the production database; .env.local (dev) and .env.test.local are fine.
if (/--env-file[=\s]+["']?(?:\.\/|\.\\)?\.env(?=$|["'\s])/i.test(command)) {
  block("--env-file=.env loads the production database. Use .env.local (the dev branch) instead.")
}

// --- recursive force deletes outside node_modules / .next ----------------------
const SAFE_TARGET = (t) => /(^|[\\/])(node_modules|\.next)[\\/]?$/.test(t.replace(/["']/g, ""))
for (const seg of command.split(/&&|\|\||;|\|/)) {
  const s = seg.trim()
  const rm = /^(?:sudo\s+)?rm\s+(.*)$/i.exec(s)
  if (rm) {
    const args = rm[1].split(/\s+/).filter(Boolean)
    const flags = args.filter((a) => a.startsWith("-"))
    const recursive = flags.some((f) => /^-[a-z]*r/i.test(f) || f === "--recursive")
    const force = flags.some((f) => /^-[a-z]*f/i.test(f) || f === "--force")
    const targets = args.filter((a) => !a.startsWith("-"))
    if (recursive && force && (targets.length === 0 || !targets.every(SAFE_TARGET))) {
      block("rm -rf is only allowed on node_modules or .next.")
    }
  }
  const ri = /^(?:Remove-Item|rm|del|ri|rmdir|rd)\b(.*)$/i.exec(s)
  if (ri && /-Recurse\b/i.test(ri[1]) && /-Force\b/i.test(ri[1])) {
    const targets = ri[1].replace(/-\w+(\s*:\s*\$\w+)?/g, " ").split(/\s+/).filter(Boolean)
    if (targets.length === 0 || !targets.every(SAFE_TARGET)) block("Remove-Item -Recurse -Force is only allowed on node_modules or .next.")
  }
  if (/^(rmdir|rd)\b/i.test(s) && /\/s\b/i.test(s) && /\/q\b/i.test(s)) {
    const targets = s.split(/\s+/).slice(1).filter((a) => !a.startsWith("/"))
    if (targets.length === 0 || !targets.every(SAFE_TARGET)) block("rmdir /s /q is only allowed on node_modules or .next.")
  }
}

// --- force pushes --------------------------------------------------------------
for (const seg of command.split(/&&|\|\||;|\|/)) {
  const m = /\bgit(?:\s+-\S+(?:\s+\S+)?)*\s+push\b(.*)$/i.exec(seg.trim())
  if (m && (/(^|\s)(--force\b|--force-with-lease\b|--force-if-includes\b|-[a-z]*f[a-z]*\b)/i.test(m[1]) || /(^|\s)\+\S+/.test(m[1]))) {
    block("git push --force is not allowed. Push a new commit or open a PR instead.")
  }
}

// --- the production database host --------------------------------------------
const marker = productionDbMarker()
if (marker && command.toLowerCase().includes(marker)) {
  block("it names the production database host. Use the dev branch (.env.local) instead.")
}

process.exit(0)
