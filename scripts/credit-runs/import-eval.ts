// Smart Import accuracy test: Claude writes realistic flyers/emails/texts WITH known answers, the real
// Smart Import extraction (lib/smart-import-ai.ts, same prompt and model as production) reads them,
// and a judge scores each result.
// Usage:  npx tsx --tsconfig tsconfig.json scripts/credit-runs/import-eval.ts [--batches 10]
// Output: scripts/credit-runs/out/import-eval.md
import fs from "node:fs"
import path from "node:path"
import { ask, parseJson, pmap, usageLine, OUT_DIR, loadKey } from "./lib.mjs"

loadKey()
const args = process.argv.slice(2)
const batches = Number(args.includes("--batches") ? args[args.indexOf("--batches") + 1] : 10)
const TZ = "America/New_York"
const TODAY = { date: "2026-11-10", weekday: "Tuesday" }

const KINDS = [
  "a school newsletter with several dates mixed into paragraphs",
  "a soccer / baseball / dance team schedule table",
  "a text message from another parent about a birthday party",
  "an email from a pediatrician or dentist office confirming appointments",
  "a church or community flyer with a recurring event",
  "a PTA email listing a week of events with relative dates (\"next Thursday\", \"this Saturday\")",
  "a camp or after-school program flyer with a date range and a pickup time",
  "a messy forwarded email chain with one real event buried in it",
  "a flyer with no year, 12-hour and 24-hour times mixed, and a location line",
  "text with NO events at all (a recipe, a bill, small talk) - expected is an empty list",
]

type Case = { kind: string; text: string; expected: Array<Record<string, string>> }

async function main() {
console.log(`Generating ${batches * 5} test cases...`)
const cases: Case[] = (
  await pmap(Array.from({ length: batches }, (_, i) => i), 3, async (i: number) => {
    const kind = KINDS[i % KINDS.length]
    const reply = await ask({
      system: "You create test data for an event-extraction feature. Reply ONLY JSON.",
      user: `Today is ${TODAY.weekday} ${TODAY.date} (time zone ${TZ}). Write 5 DIFFERENT realistic documents of this kind: ${kind}.
Make them messy like real life (varied wording, abbreviations, typos). For each, give the exact list of events a careful person would add to a family calendar.
JSON: [{"text":"...","expected":[{"title":"","date":"YYYY-MM-DD","startTime":"HH:MM or null","endTime":"HH:MM or null","location":"or null"}]}]`,
      maxTokens: 6000,
    })
    return (parseJson(reply) as Case[]).map((c) => ({ ...c, kind }))
  })
).flat()

const { smartImportAi } = await import("../../lib/smart-import-ai")

const SCORES: Array<{ kind: string; text: string; expected: unknown; got: unknown; score: number; notes: string }> = []
await pmap(cases, 4, async (c: Case) => {
  let got: unknown
  try {
    got = await smartImportAi.extract({ text: c.text, timeZone: TZ, today: TODAY })
  } catch (err) {
    got = { error: (err as Error).message }
  }
  const verdict = await ask({
    system: "You grade an event extractor against the correct answer. Reply ONLY JSON: {\"score\":0-100,\"notes\":\"what was missed, invented, or wrong (date, time, title, location)\"}. 100 = same events with correct dates and times. Penalize invented events, missed events, wrong dates and wrong times heavily; be lenient on title wording.",
    user: `TEXT:\n${c.text}\n\nCORRECT:\n${JSON.stringify(c.expected)}\n\nEXTRACTOR OUTPUT:\n${JSON.stringify(got)}`,
    maxTokens: 800,
  })
  try {
    const j = parseJson(verdict)
    SCORES.push({ kind: c.kind, text: c.text, expected: c.expected, got, score: j.score, notes: j.notes })
  } catch {
    SCORES.push({ kind: c.kind, text: c.text, expected: c.expected, got, score: 0, notes: "grader failed" })
  }
})

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
const byKind = [...new Set(SCORES.map((s) => s.kind))].map((k) => `- ${avg(SCORES.filter((s) => s.kind === k).map((s) => s.score))}  ${k}`)
const worst = [...SCORES].sort((a, b) => a.score - b.score).slice(0, 15)
const md = [
  `# Smart Import accuracy (${new Date().toISOString().slice(0, 10)})`,
  `${SCORES.length} cases, average score ${avg(SCORES.map((s) => s.score))}/100. Usage: ${usageLine()}`,
  "", "## By kind", ...byKind, "", "## Worst 15",
  ...worst.flatMap((s) => [
    `### ${s.score}/100 - ${s.kind}`, `**Notes:** ${s.notes}`, "```", s.text.slice(0, 1200), "```",
    "Expected: `" + JSON.stringify(s.expected) + "`", "", "Got: `" + JSON.stringify(s.got).slice(0, 1500) + "`", "",
  ]),
].join("\n")
fs.writeFileSync(path.join(OUT_DIR, "import-eval.md"), md)
fs.writeFileSync(path.join(OUT_DIR, "import-eval.json"), JSON.stringify(SCORES, null, 2))
console.log(`Done. average ${avg(SCORES.map((s) => s.score))}/100 -> scripts/credit-runs/out/import-eval.md\n${usageLine()}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
