// Security review of every API route, then a second pass that tries to refute each finding.
// Usage:  node scripts/credit-runs/security-review.mjs [--limit 20] [--filter families]
// Resumable: finished files are cached in scripts/credit-runs/out/security/.
// Output: scripts/credit-runs/out/security-report.md
import fs from "node:fs"
import path from "node:path"
import { ask, parseJson, pmap, walk, usageLine, OUT_DIR, loadKey } from "./lib.mjs"

loadKey()
const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null }
const limit = Number(flag("limit") || 0)
const filter = flag("filter")

const root = process.cwd()
const CACHE = path.join(OUT_DIR, "security")
fs.mkdirSync(CACHE, { recursive: true })

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")
// Shared context every review sees, so it can judge auth helpers correctly.
const CONTEXT = ["lib/auth.ts", "lib/db.ts", "middleware.ts", "proxy.ts"]
  .map((f) => ({ f, body: read(path.join(root, f)) }))
  .filter((x) => x.body)
  .map((x) => `=== ${x.f} ===\n${x.body.slice(0, 40_000)}`)
  .join("\n\n")

const SYSTEM = `You are a senior application security engineer reviewing one Next.js API route of "Togethr", a family coordination app.
It stores children's data, live location, calendars and subscription billing (Stripe), on Neon Postgres. Users belong to families
with roles PARENT, GUARDIAN, ADULT, CHILD, GUEST; families.owner_id is the account holder.
Shared helpers are provided as context. The sql tagged template is parameterised (safe); string-built SQL or sql.unsafe is not.

Look for REAL, exploitable problems only:
- missing or weak authentication; missing role checks (a CHILD or GUEST doing a parent action; a non-owner doing an owner action)
- IDOR / cross-family access: using an id from the URL or body without checking it belongs to the caller's family
- data exposure: returning other families' or other users' data, tokens, password hashes, emails, phone numbers, locations of people the caller may not see
- SQL injection, mass assignment, unvalidated input that reaches the database, files, URLs or emails
- webhook and cron endpoints without signature or secret verification
- file upload validation, SSRF, open redirects, secrets or personal data in logs or responses
- missing rate limits on login, password reset, invite, SMS or email sending endpoints
- billing/entitlement bypass (granting paid features without payment)
Do not report style, hypothetical issues without a concrete exploit, or things the shared context already handles.
Reply with ONLY JSON: {"findings":[{"severity":"critical|high|medium|low","title":"","where":"function or line hint","explanation":"","exploit":"step by step with the exact request","fix":""}]}
Use {"findings":[]} when the route is fine.`

let files = walk(path.join(root, "app", "api"), (p) => p.endsWith("route.ts"))
if (filter) files = files.filter((f) => f.includes(filter))
if (limit) files = files.slice(0, limit)
console.log(`Reviewing ${files.length} routes`)

async function review(file) {
  const rel = path.relative(root, file).replaceAll("\\", "/")
  const cacheFile = path.join(CACHE, rel.replaceAll("/", "__") + ".json")
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"))
  const code = read(file)
  let findings = []
  try {
    const reply = await ask({
      system: SYSTEM,
      user: `${CONTEXT}\n\n=== ROUTE UNDER REVIEW: ${rel} ===\n${code}`,
      maxTokens: 6000,
    })
    findings = parseJson(reply).findings || []
    // Second pass: try to refute every medium-or-worse finding.
    for (const f of findings) {
      if (f.severity === "low") { f.verdict = "UNVERIFIED"; continue }
      const v = await ask({
        system: "You are a skeptical security reviewer. Decide whether the claimed vulnerability is real, given the code and shared helpers. Reply ONLY JSON: {\"verdict\":\"CONFIRMED|REFUTED|UNCERTAIN\",\"reason\":\"\"}",
        user: `${CONTEXT}\n\n=== ${rel} ===\n${code}\n\n=== CLAIMED FINDING ===\n${JSON.stringify(f, null, 2)}`,
        maxTokens: 1500,
      })
      try { const j = parseJson(v); f.verdict = j.verdict; f.verdictReason = j.reason } catch { f.verdict = "UNCERTAIN" }
    }
  } catch (err) {
    if (String(err.message).includes("BUDGET_TOKENS")) throw err
    console.warn(`  skip ${rel}: ${err.message}`)
    return { file: rel, error: err.message, findings: [] }
  }
  const result = { file: rel, findings }
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2))
  if (findings.length) console.log(`  ${rel}: ${findings.map((f) => `${f.severity}/${f.verdict}`).join(", ")}`)
  return result
}

const results = (await pmap(files, 4, review)).filter(Boolean)
const order = { critical: 0, high: 1, medium: 2, low: 3 }
const all = results.flatMap((r) => r.findings.map((f) => ({ ...f, file: r.file })))
  .filter((f) => f.verdict !== "REFUTED")
  .sort((a, b) => order[a.severity] - order[b.severity])

const md = [
  `# Security review (${new Date().toISOString().slice(0, 10)})`,
  `${results.length} routes reviewed, ${all.length} findings after verification (refuted ones removed).`,
  `Usage: ${usageLine()}`,
  "",
  ...all.flatMap((f, i) => [
    `## ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`,
    `**File:** \`${f.file}\`  **Where:** ${f.where}  **Verdict:** ${f.verdict}`,
    "",
    f.explanation, "", `**Exploit:** ${f.exploit}`, "", `**Fix:** ${f.fix}`, f.verdictReason ? `\n_Verifier: ${f.verdictReason}_` : "", "",
  ]),
].join("\n")
fs.writeFileSync(path.join(OUT_DIR, "security-report.md"), md)
console.log(`\nDone. ${all.length} findings -> scripts/credit-runs/out/security-report.md\n${usageLine()}`)
